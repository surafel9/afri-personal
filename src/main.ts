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
import http from 'node:http';
import { config, getMonitoredChannels } from './config/index.js';
import { logger } from './observability/logger.js';
import { createDb } from './database/client.js';
import { runMigrations } from './database/migrate.js';
import { seedDatabase } from './database/seed.js';
import { createProfileRepo } from './database/repositories/profile.js';
import { createAppStateRepo } from './database/repositories/app-state.js';
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

  // 1. Initialize database, run migrations, and seed default profile
  const { db, sqlite } = createDb(config.DB_PATH);
  await runMigrations(sqlite);
  seedDatabase(db);

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

  // 5. Initialize AdapterPoller for monitored channels
  let poller: AdapterPoller | null = null;
  const appStateRepo = createAppStateRepo(db);
  const monitoredChannels = getMonitoredChannels();

  if (monitoredChannels.length > 0) {
    const adapters = monitoredChannels.map(
      (ch) => new TelegramWebAdapter(ch.webUrl, db),
    );

    poller = new AdapterPoller(db, adapters, {
      intervalMs: config.POLLING_INTERVAL_MS,
      onBatchComplete: async (batchStats) => {
        // Run coordinator evaluation right away so pending messages are evaluated and delivered
        const evalSummary = await coordinator.runCycle();
        const isPaused = appStateRepo.get('paused') === 'true';
        const reportsEnabled =
          appStateRepo.get('periodic_reports_enabled') !== 'false';

        // When reports are turned OFF, only relevant job notifications are delivered above.
        // We skip sending the periodic 15-minute summary message.
        if (!reportsEnabled) {
          logger.debug('15-minute periodic reports are OFF; skipping summary message');
          return;
        }

        let reportText: string;
        const totalNew = batchStats.totalNewPosts;
        const matches = evalSummary.matches;
        // Any new post that is not relevant is always counted as rejected
        const rejected = Math.max(
          totalNew - matches,
          evalSummary.noMatch + evalSummary.skipped + evalSummary.excluded,
        );

        if (totalNew === 0) {
          const channelNames = monitoredChannels.map((c) => c.name).join(', ');
          reportText =
            `⏱️ <b>15-Minute Scan Report</b>\n` +
            `📡 <b>Channels Monitored (${monitoredChannels.length}):</b>\n${channelNames}\n\n` +
            `• <b>New Posts:</b> 0\n` +
            `• <b>Status:</b> All caught up (no new posts)`;
        } else {
          // Channel-by-channel breakdown
          const breakdown = batchStats.results
            .map((r) => {
              const handle = r.sourceId.replace('telegram-web:', '');
              return `• <b>@${handle}:</b> ${r.newPosts} new post${r.newPosts === 1 ? '' : 's'}`;
            })
            .join('\n');

          reportText =
            `⏱️ <b>15-Minute Scan Report</b>\n` +
            `📡 <b>Channels Breakdown:</b>\n${breakdown}\n\n` +
            `📊 <b>Screening Summary:</b>\n` +
            `• <b>Total New Posts:</b> ${totalNew}\n` +
            `• <b>Relevant:</b> ${evalSummary.matches}` +
            (evalSummary.matches > 0 ? ' 🎯 (alerted above)' : '') +
            `\n• <b>Rejected:</b> ${rejected}`;
        }

        if (isPaused) {
          reportText += '\n• <b>State:</b> ⏸️ PAUSED';
        }

        try {
          await bot.api.sendMessage(config.OWNER_CHAT_ID, reportText, {
            parse_mode: 'HTML',
          });
        } catch (err) {
          logger.error({ err }, 'Failed to deliver 15-minute scan report to owner');
        }
      },
    });

    logger.info(
      {
        channels: monitoredChannels.map((c) => c.name),
        intervalMs: config.POLLING_INTERVAL_MS,
      },
      'Automated multi-channel polling enabled with 15-minute periodic scan reports',
    );
  } else {
    logger.info('No channels configured — running in manual import mode only');
  }

  // Start coordinator background loop
  coordinator.start();

  // Start adapter poller (if configured)
  poller?.start();

  // 6. Start HTTP health server for cloud platforms (Render, etc.)
  const port = process.env.PORT || 8080;
  const profileRepo = createProfileRepo(db);
  const server = http.createServer((_req, res) => {
    const active = profileRepo.getActive();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'afripersonal',
        activeProfile: active ? active.name : null,
      }),
    );
  });
  server.listen(port, () => {
    logger.info({ port }, 'Health server listening');
  });

  // Keep Render awake by self-pinging every 9 minutes (Render free tier sleeps after 15m)
  const pingUrl =
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RENDER ? 'https://afri-personal.onrender.com' : null);
  let keepAliveInterval: NodeJS.Timeout | null = null;
  if (pingUrl) {
    keepAliveInterval = setInterval(async () => {
      try {
        await fetch(pingUrl);
        logger.debug({ url: pingUrl }, 'Keep-alive self-ping sent');
      } catch (err: unknown) {
        logger.debug({ err: (err as Error)?.message }, 'Keep-alive self-ping non-fatal warning');
      }
    }, 9 * 60 * 1000);
  }

  // 7. Handle graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, closing resources...');

    try {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      server.close();
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
          { command: 'start', description: 'Start & welcome menu' },
          { command: 'menu', description: 'Open action menu & docked keyboard' },
          { command: 'fetch', description: 'Screen posts by channel (50-200)' },
          { command: 'reports', description: 'Toggle 15m scan reports (ON/OFF)' },
          { command: 'status', description: 'Check status, metrics & feedback' },
          { command: 'sources', description: 'View monitored channels' },
          { command: 'profile', description: 'View career profile' },
          { command: 'clear', description: 'Clear chat' },
          { command: 'help', description: 'Help & instructions' },
        ]);
        await bot.api.setChatMenuButton({
          menu_button: { type: 'commands' },
        });
        await bot.api.setMyDescription(
          '👋 Welcome to AfriPersonal!\nYour automated personal technical job watcher for Ethiopian channels.',
        );
        await bot.api.setMyShortDescription(
          'Automated technical job watcher for Ethiopian channels',
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
