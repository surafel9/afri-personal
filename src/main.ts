/**
 * AfriPersonal — main entry point
 *
 * Boots database, runs migrations, initializes the grammY bot,
 * starts the pipeline coordinator, notification delivery queue,
 * and (when TELEGRAM_CHANNEL_URL is configured) the AdapterPoller
 * that automatically fetches new posts from the public channel.
 *
 * Environment variables:
 *   Required: BOT_TOKEN, OWNER_CHAT_ID
 *   Optional: TELEGRAM_CHANNEL_URL, POLLING_INTERVAL_MS, LOG_LEVEL,
 *             DB_PATH, NOTIFICATION_THRESHOLD, DATA_RETENTION_DAYS
 */
import { config } from './config/index.js';
import { logger } from './observability/logger.js';
import { createDb } from './database/client.js';
import { runMigrations } from './database/migrate.js';
import { createBot } from './bot/bot.js';
import { NotificationDeliveryService } from './notifications/delivery.js';
import { PipelineCoordinator } from './pipeline/coordinator.js';
import { AdapterPoller } from './pipeline/poller.js';
import { TelegramWebAdapter } from './sources/telegram-web-adapter.js';

async function main(): Promise<void> {
  logger.info(
    {
      dbPath: config.DB_PATH,
      logLevel: config.LOG_LEVEL,
      notificationThreshold: config.NOTIFICATION_THRESHOLD,
      ownerChatId: config.OWNER_CHAT_ID,
      channelUrl: config.TELEGRAM_CHANNEL_URL ?? '(not configured — manual import only)',
      pollingIntervalMs: config.POLLING_INTERVAL_MS,
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

  // 4. Initialize pipeline coordinator (evaluates pending messages + delivers notifications)
  const coordinator = new PipelineCoordinator(db, deliveryService, {
    retentionDays: config.DATA_RETENTION_DAYS,
  });

  // 5. Initialize AdapterPoller if TELEGRAM_CHANNEL_URL is configured
  let poller: AdapterPoller | null = null;
  if (config.TELEGRAM_CHANNEL_URL) {
    const telegramWebAdapter = new TelegramWebAdapter(config.TELEGRAM_CHANNEL_URL, db);
    poller = new AdapterPoller(db, [telegramWebAdapter], {
      intervalMs: config.POLLING_INTERVAL_MS,
    });
    logger.info(
      { channelUrl: config.TELEGRAM_CHANNEL_URL, intervalMs: config.POLLING_INTERVAL_MS },
      'Automated channel polling enabled',
    );
  } else {
    logger.info('TELEGRAM_CHANNEL_URL not set — running in manual import mode only');
  }

  // Start coordinator background loop
  coordinator.start();

  // Start adapter poller (if configured)
  poller?.start();

  // 6. Handle graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, closing resources...');

    try {
      poller?.stop();
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

  // 7. Start bot long polling
  logger.info('Starting Telegram bot long polling...');
  await bot.start({
    onStart: async (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        'AfriPersonal bot is live and polling',
      );
      try {
        await bot.api.setMyCommands([
          { command: 'start', description: 'Start & welcome' },
          { command: 'fetch50', description: 'Fetch recent 50 jobs' },
          { command: 'status', description: 'Check status' },
          { command: 'profile', description: 'View profile' },
          { command: 'clear', description: 'Clear chat' },
          { command: 'help', description: 'Help & instructions' },
        ]);
        await bot.api.setMyDescription(
          '👋 Welcome to AfriPersonal!\nYour automated personal technical job watcher for Ethiopian channels.',
        );
        await bot.api.setMyShortDescription(
          'Automated technical job watcher for @freelance_ethio',
        );
      } catch (err) {
        logger.warn({ err }, 'Failed to set Telegram bot commands menu');
      }
    },
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
