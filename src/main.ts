/**
 * AfriPersonal — main entry point
 *
 * Boots database, runs migrations, initializes the grammY bot,
 * starts the pipeline coordinator and notification delivery queue,
 * and sets up graceful shutdown handlers.
 */
import { config } from './config/index.js';
import { logger } from './observability/logger.js';
import { createDb } from './database/client.js';
import { runMigrations } from './database/migrate.js';
import { createBot } from './bot/bot.js';
import { NotificationDeliveryService } from './notifications/delivery.js';
import { PipelineCoordinator } from './pipeline/coordinator.js';

async function main(): Promise<void> {
  logger.info(
    {
      dbPath: config.DB_PATH,
      logLevel: config.LOG_LEVEL,
      notificationThreshold: config.NOTIFICATION_THRESHOLD,
      ownerChatId: config.OWNER_CHAT_ID,
    },
    'AfriPersonal starting',
  );

  // 1. Initialize database and run migrations
  const { db, sqlite } = createDb(config.DB_PATH);
  await runMigrations(sqlite);

  // 2. Initialize Telegram bot
  const bot = createBot(config.BOT_TOKEN, config.OWNER_CHAT_ID, db);

  // 3. Initialize notification delivery service
  const deliveryService = new NotificationDeliveryService(
    db,
    bot.api,
    config.OWNER_CHAT_ID,
  );

  // 4. Initialize pipeline coordinator
  const coordinator = new PipelineCoordinator(db, deliveryService, {
    retentionDays: config.DATA_RETENTION_DAYS,
  });

  // Start coordinator background loop
  coordinator.start();

  // 5. Handle graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, closing resources...');

    try {
      coordinator.stop();
      await bot.stop();
      sqlite.close();
      logger.info('AfriPersonal shut down gracefully');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 6. Start bot long polling
  logger.info('Starting Telegram bot long polling...');
  await bot.start({
    onStart: (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        'AfriPersonal bot is live and polling',
      );
    },
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
