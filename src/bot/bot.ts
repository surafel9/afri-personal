/**
 * bot.ts
 * Telegram bot implementation using grammY.
 * Enforces strict single-owner security, provides operational commands,
 * handles forwarded/manual message import, and records user feedback.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  Bot,
  Context,
  Keyboard,
  InlineKeyboard,
  GrammyError,
  HttpError,
  InputFile,
  type BotConfig,
} from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { sql } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import {
  notifications,
  evaluations,
  jobs,
  feedback,
  sourceMessages,
} from '../database/schema.js';
import { createSourcesRepo } from '../database/repositories/sources.js';
import { createProfileRepo } from '../database/repositories/profile.js';
import { createEvaluationsRepo } from '../database/repositories/evaluations.js';
import { createMessagesRepo } from '../database/repositories/messages.js';
import { createNotificationsRepo } from '../database/repositories/notifications.js';
import { createFeedbackRepo } from '../database/repositories/feedback.js';
import { createAppStateRepo } from '../database/repositories/app-state.js';
import { IngestionService } from '../pipeline/ingestion.js';
import { ManualImportAdapter } from '../sources/manual-adapter.js';
import { TelegramWebAdapter } from '../sources/telegram-web-adapter.js';
import { formatVerbatim } from '../notifications/formatter.js';
import { evaluate, profileFromDb } from '../matching/engine.js';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';

export const removeKeyboardMarkup = { remove_keyboard: true as const };

export function getWelcomeText(): string {
  return '👋 <b>Welcome to AfriPersonal!</b>';
}

export function getStartActionText(): string {
  return (
    `⚡ <b>Job Watcher Active</b>\n\n` +
    `Monitoring <b>@freelance_ethio</b> for technical roles.\n\n` +
    `<b>Commands:</b>\n` +
    `• /fetch50 — Fetch recent 50 jobs\n` +
    `• /status — Check status\n` +
    `• /profile — View your profile\n` +
    `• /clear — Clear chat history\n` +
    `• /help — Help & instructions`
  );
}

export function getWelcomeStickerPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'assets/AfriPersonal.webp'),
    path.resolve(import.meta.dirname, '../../assets/AfriPersonal.webp'),
    path.resolve(process.cwd(), 'AfriPersonal.webp'),
    path.resolve(import.meta.dirname, '../../AfriPersonal.webp'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function getWelcomePhotoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'assets/AfriPersonal.png'),
    path.resolve(import.meta.dirname, '../../assets/AfriPersonal.png'),
    path.resolve(process.cwd(), 'AfriPersonal.png'),
    path.resolve(import.meta.dirname, '../../AfriPersonal.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function createBot(
  token: string,
  ownerChatId: number,
  db: Db,
  botConfig?: BotConfig<Context>,
): Bot {
  const bot = new Bot(token, botConfig);

  // ── Global Error Handler: Log errors and keep polling alive ─────────────────
  bot.catch(err => {
    const ctx = err.ctx;
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error(
        {
          updateId: ctx.update?.update_id,
          method: e.method,
          errorCode: e.error_code,
          description: e.description,
        },
        'GrammyError while handling update',
      );
    } else if (e instanceof HttpError) {
      logger.error(
        { updateId: ctx.update?.update_id, err: e },
        'HttpError while communicating with Telegram',
      );
    } else {
      logger.error(
        { updateId: ctx.update?.update_id, err: e },
        'Unhandled error in bot update handler',
      );
    }
  });

  const sourcesRepo = createSourcesRepo(db);
  const profileRepo = createProfileRepo(db);
  const evaluationsRepo = createEvaluationsRepo(db);
  const messagesRepo = createMessagesRepo(db);
  const notificationsRepo = createNotificationsRepo(db);
  const feedbackRepo = createFeedbackRepo(db);
  const appStateRepo = createAppStateRepo(db);
  const ingestionService = new IngestionService(db);
  const manualAdapter = new ManualImportAdapter();

  // ── Security Middleware: Single-owner verification ─────────────────────────
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== ownerChatId) {
      logger.warn(
        { userId, username: ctx.from?.username },
        'Unauthorized access rejected',
      );
      if (ctx.chat?.type === 'private') {
        try {
          await ctx.reply(
            '⛔ Access denied. AfriPersonal is a private, single-user assistant.',
          );
        } catch (err) {
          logger.warn(
            { err, userId, username: ctx.from?.username },
            'Failed to send access denied reply (e.g. bot was blocked by user)',
          );
        }
      }
      return;
    }
    await next();
  });

  async function sendWelcomeMessage(
    chatId: number,
    ctx?: Context,
  ): Promise<{ photoMsgId?: number | undefined; actionMsgId: number }> {
    const stickerPath = getWelcomeStickerPath();
    const cachedStickerId = appStateRepo.get('welcome_sticker_file_id');
    const stickerSource =
      cachedStickerId || (stickerPath ? new InputFile(stickerPath) : null);
    let photoMsgId: number | undefined;
    let usedSticker = false;

    if (stickerSource) {
      try {
        const sentSticker = ctx
          ? await ctx.replyWithSticker(stickerSource)
          : await bot.api.sendSticker(chatId, stickerSource);
        photoMsgId = sentSticker.message_id;
        usedSticker = true;
        if (sentSticker.sticker?.file_id) {
          appStateRepo.set(
            'welcome_sticker_file_id',
            sentSticker.sticker.file_id,
          );
        }
      } catch (err) {
        logger.warn(
          { err },
          'Failed to send welcome sticker, falling back to photo',
        );
      }
    }

    if (!photoMsgId) {
      const photoPath = getWelcomePhotoPath();
      const cachedFileId = appStateRepo.get('welcome_photo_file_id');
      const photoSource =
        cachedFileId || (photoPath ? new InputFile(photoPath) : null);

      if (photoSource) {
        try {
          const sentPhoto = ctx
            ? await ctx.replyWithPhoto(photoSource, {
                caption: getWelcomeText(),
                parse_mode: 'HTML',
              })
            : await bot.api.sendPhoto(chatId, photoSource, {
                caption: getWelcomeText(),
                parse_mode: 'HTML',
              });

          photoMsgId = sentPhoto.message_id;
          if (sentPhoto.photo && sentPhoto.photo.length > 0) {
            const largest = sentPhoto.photo[sentPhoto.photo.length - 1];
            if (largest?.file_id) {
              appStateRepo.set('welcome_photo_file_id', largest.file_id);
            }
          }
        } catch (err) {
          logger.warn(
            { err },
            'Failed to send welcome photo, proceeding with action message',
          );
        }
      }
    }

    const actionText =
      photoMsgId && !usedSticker
        ? getStartActionText()
        : `${getWelcomeText()}\n\n${getStartActionText()}`;

    const sentAction = ctx
      ? await ctx.reply(actionText, {
          parse_mode: 'HTML',
          reply_markup: removeKeyboardMarkup,
        })
      : await bot.api.sendMessage(chatId, actionText, {
          parse_mode: 'HTML',
          reply_markup: removeKeyboardMarkup,
        });

    return { photoMsgId, actionMsgId: sentAction.message_id };
  }

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', async ctx => {
    const oldPhoto = appStateRepo.get('welcome_photo_id');
    const oldMsg = appStateRepo.get('welcome_msg_id');
    if (oldPhoto) {
      try {
        await bot.api.deleteMessage(ownerChatId, Number(oldPhoto));
      } catch {}
    }
    if (oldMsg) {
      try {
        await bot.api.deleteMessage(ownerChatId, Number(oldMsg));
      } catch {}
    }

    const { photoMsgId, actionMsgId } = await sendWelcomeMessage(
      ownerChatId,
      ctx,
    );
    if (photoMsgId) appStateRepo.set('welcome_photo_id', String(photoMsgId));
    appStateRepo.set('welcome_msg_id', String(actionMsgId));
  });

  async function clearAllChatMessages(
    chatId: number,
    currentMsgId?: number,
  ): Promise<number> {
    const allNotifs = db.select().from(notifications).all();
    const idsToDelete = new Set<number>();
    const welcomePhotoId = Number(appStateRepo.get('welcome_photo_id') ?? 0);
    const welcomeMsgId = Number(appStateRepo.get('welcome_msg_id') ?? 0);
    const preservedIds = new Set<number>();
    if (welcomePhotoId) preservedIds.add(welcomePhotoId);
    if (welcomeMsgId) preservedIds.add(welcomeMsgId);

    for (const notif of allNotifs) {
      if (
        notif.telegramMessageId &&
        !preservedIds.has(notif.telegramMessageId)
      ) {
        idsToDelete.add(notif.telegramMessageId);
      }
    }

    if (currentMsgId) {
      const minId =
        preservedIds.size > 0
          ? Math.min(...preservedIds) + 1
          : Math.max(1, currentMsgId - 500);
      for (let id = currentMsgId; id >= minId; id--) {
        if (!preservedIds.has(id)) {
          idsToDelete.add(id);
        }
      }
    }

    const sortedIds = Array.from(idsToDelete).sort((a, b) => b - a);
    let deletedCount = 0;

    const CHUNK_SIZE = 100;
    for (let i = 0; i < sortedIds.length; i += CHUNK_SIZE) {
      const chunk = sortedIds.slice(i, i + CHUNK_SIZE);
      try {
        await bot.api.deleteMessages(chatId, chunk);
        deletedCount += chunk.length;
      } catch {
        for (const id of chunk) {
          try {
            await bot.api.deleteMessage(chatId, id);
            deletedCount++;
          } catch {}
        }
      }
    }

    db.delete(notifications).run();

    if (preservedIds.size === 0) {
      const { photoMsgId, actionMsgId } = await sendWelcomeMessage(chatId);
      if (photoMsgId) appStateRepo.set('welcome_photo_id', String(photoMsgId));
      appStateRepo.set('welcome_msg_id', String(actionMsgId));
    }

    return deletedCount;
  }

  const confirmClearKeyboard = new InlineKeyboard()
    .text('✅ Yes, Clear Chat', 'confirm:clear')
    .text('❌ Cancel', 'confirm:cancel');

  const handleClear = async (ctx: Context) => {
    await ctx.reply(
      '⚠️ <b>Are you sure you want to clear conversation messages?</b>',
      {
        parse_mode: 'HTML',
        reply_markup: confirmClearKeyboard,
      },
    );
  };

  bot.command('clear', handleClear);
  bot.hears('🧹 Clear Chat', handleClear);

  // ── /fetch50 — On-demand 50 recent posts fetcher ───────────────────────────
  const handleFetch50 = async (ctx: Context) => {
    await ctx.reply(
      '⏳ <b>Fetching and screening the 50 most recent posts from @freelance_ethio...</b>',
      {
        parse_mode: 'HTML',
      },
    );

    try {
      const channelUrl =
        config.TELEGRAM_CHANNEL_URL ?? 'https://t.me/s/freelance_ethio';
      const adapter = new TelegramWebAdapter(channelUrl, db);
      const rawPosts = await adapter.fetchRecent(50);

      const activeProfileRow = profileRepo.getActive();
      if (!activeProfileRow) {
        await ctx.reply('⚠️ No active profile found.');
        return;
      }
      const profile = profileFromDb(activeProfileRow);

      let matchesCount = 0;
      let evaluatedCount = 0;

      for (const raw of rawPosts) {
        evaluatedCount++;
        // Ensure message exists in database
        const ingestRes = await ingestionService.ingestMessage(raw);
        const existingMsg =
          ingestRes.message ??
          messagesRepo.findBySourceAndExternalId(raw.sourceId, raw.externalId);

        if (!existingMsg) {
          logger.warn(
            { raw },
            'Could not resolve message row for on-demand fetch',
          );
          continue;
        }

        const msgId = existingMsg.id;

        // Evaluate with strict tech title filter
        const evalRes = evaluate(raw.text, profile);

        if (evalRes.verdict === 'match') {
          matchesCount++;
          // Queue notification
          const notif = notificationsRepo.queue(
            evaluationsRepo.insert({
              messageId: msgId,
              profileVersion: profile.version,
              ruleEngineVersion: evalRes.ruleEngineVersion,
              isJobAnnouncement: evalRes.isJobAnnouncement,
              extractedTitle: evalRes.extracted.title,
              extractedCompany: evalRes.extracted.company,
              extractedLocation: evalRes.extracted.location,
              extractedWorkMode: evalRes.extracted.workMode,
              extractedEmploymentType: evalRes.extracted.employmentType,
              extractedDeadline: evalRes.extracted.deadline,
              extractedApplyMethod: evalRes.extracted.applyMethod,
              matchedSkills: evalRes.matchedSkills,
              matchedRoles: evalRes.matchedRoles,
              missingInfo: evalRes.missingInfo,
              triggeredExclusions: evalRes.triggeredExclusions,
              score: evalRes.score,
              verdict: evalRes.verdict,
              matchReasons: evalRes.matchReasons,
            }).id,
          );

          const { text, keyboard } = formatVerbatim(
            raw.text,
            raw.links,
            notif.id,
          );

          try {
            const sent = await bot.api.sendMessage(ownerChatId, text, {
              parse_mode: 'HTML',
              reply_markup: keyboard,
            });
            notificationsRepo.updateStatus(notif.id, 'delivered', {
              telegramMessageId: sent.message_id,
            });
          } catch (err) {
            logger.warn({ err }, 'Failed to deliver on-demand notification');
          }
        }
      }

      await ctx.reply(
        `✅ <b>Scan Complete!</b>\n\n` +
          `• Evaluated: <b>${evaluatedCount}</b> recent channel posts\n` +
          `• Qualified Tech Jobs: <b>${matchesCount}</b> delivered to your chat\n` +
          `• Filter Rule: Strict Technical Title only`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      logger.error({ err }, 'Error during on-demand 50 fetch');
      await ctx.reply(
        '⚠️ Error fetching posts from channel. Please check your internet connection and try again.',
      );
    }
  };

  bot.command('fetch50', handleFetch50);
  bot.hears('📥 Fetch 50 Recent Jobs', handleFetch50);

  // ── /help ──────────────────────────────────────────────────────────────────
  bot.command('help', async ctx => {
    const text =
      `📖 <b>AfriPersonal Help & Usage</b>\n\n` +
      `<b>100% Automated Job Watcher:</b>\n` +
      `• <b>Channel Polling:</b> Automatically monitors @freelance_ethio every 15 minutes.\n` +
      `• <b>Zero Manual Work:</b> You never need to browse channels or copy/paste posts.\n` +
      `• <b>Strict Title Filter:</b> Only genuine tech titles (Developer, Software, Engineer, Fullstack, Mobile, DevOps, UI/UX, etc.) are matched.\n` +
      `• <b>Verbatim Delivery:</b> Sends the exact original post with direct link to your DM.\n\n` +
      `<b>Commands:</b>\n` +
      `• /clear — Clear conversation and job alerts from this chat\n` +
      `• /status — Operational health and queue depths\n` +
      `• /profile — Active career preferences and criteria\n` +
      `• /matches — Recent matched evaluations\n` +
      `• /stats — Aggregated metrics\n` +
      `• /pause — Temporarily halt notifications\n` +
      `• /resume — Unpause notifications`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /status ────────────────────────────────────────────────────────────────
  const handleStatus = async (ctx: Context) => {
    const paused = appStateRepo.get('paused') === 'true';

    // Daily metrics (today)
    const todayFetched =
      db
        .select({ count: sql<number>`count(*)` })
        .from(sourceMessages)
        .where(sql`date(${sourceMessages.fetchedAt}) = date('now')`)
        .get()?.count ?? 0;

    const todayMatches =
      db
        .select({ count: sql<number>`count(*)` })
        .from(evaluations)
        .where(
          sql`date(${evaluations.evaluatedAt}) = date('now') and ${evaluations.verdict} = 'match'`,
        )
        .get()?.count ?? 0;

    const todayRejected =
      db
        .select({ count: sql<number>`count(*)` })
        .from(evaluations)
        .where(
          sql`date(${evaluations.evaluatedAt}) = date('now') and ${evaluations.verdict} != 'match'`,
        )
        .get()?.count ?? 0;

    // All-time metrics
    const totalRead =
      db
        .select({ count: sql<number>`count(*)` })
        .from(sourceMessages)
        .get()?.count ?? 0;

    const totalMatches =
      db
        .select({ count: sql<number>`count(*)` })
        .from(evaluations)
        .where(sql`${evaluations.verdict} = 'match'`)
        .get()?.count ?? 0;

    // Feedback breakdown
    const feedbackRows = db
      .select({
        rating: feedback.rating,
        count: sql<number>`count(*)`,
      })
      .from(feedback)
      .groupBy(feedback.rating)
      .all();

    const relevantCount =
      feedbackRows.find(r => r.rating === 'relevant')?.count ?? 0;
    const notRelevantCount =
      feedbackRows.find(r => r.rating === 'not_relevant')?.count ?? 0;
    const appliedCount =
      feedbackRows.find(r => r.rating === 'applied')?.count ?? 0;

    const text =
      `📊 <b>AfriPersonal Status</b>\n\n` +
      `⚙️ <b>System:</b> ${paused ? '⏸️ PAUSED' : '▶️ RUNNING'}\n` +
      `📡 <b>Channel Watcher:</b> @freelance_ethio (Every 15m)\n\n` +
      `📅 <b>Today's Report:</b>\n` +
      `• Posts Scanned: <b>${todayFetched}</b>\n` +
      `• Matches Found: <b>${todayMatches}</b>\n` +
      `• Rejected / Clutter: <b>${todayRejected}</b>\n\n` +
      `📈 <b>All-Time History & Feedback:</b>\n` +
      `• Total Scanned: <b>${totalRead}</b>\n` +
      `• Total Matches: <b>${totalMatches}</b>\n` +
      `• 👍 Relevant: <b>${relevantCount}</b>\n` +
      `• 👎 Not Relevant: <b>${notRelevantCount}</b>\n` +
      `• 💼 Applied: <b>${appliedCount}</b>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
    });
  };

  bot.command('status', handleStatus);
  bot.hears('📊 Status', handleStatus);

  // ── /sources ───────────────────────────────────────────────────────────────
  bot.command('sources', async ctx => {
    const list = sourcesRepo.findAll();
    if (list.length === 0) {
      await ctx.reply('No sources configured.');
      return;
    }

    const items = list
      .map(
        s =>
          `📌 <b>${s.displayName}</b> [<code>${s.id}</code>]\n` +
          `• Method: ${s.ingestionMethod}\n` +
          `• Status: ${s.enabled ? '✅ Active' : '⏸️ Inactive'}\n` +
          `• Last Retrieval: ${s.lastSuccessAt ? s.lastSuccessAt : 'Never'}\n` +
          (s.lastErrorMsg ? `• ⚠️ Error: ${s.lastErrorMsg}\n` : ''),
      )
      .join('\n\n');

    await ctx.reply(`📡 <b>Configured Sources:</b>\n\n${items}`, {
      parse_mode: 'HTML',
    });
  });

  // ── /profile ───────────────────────────────────────────────────────────────
  const handleProfile = async (ctx: Context) => {
    const activeRow = profileRepo.getActive();
    if (!activeRow) {
      await ctx.reply('⚠️ No active profile found.');
      return;
    }

    const p = profileFromDb(activeRow);
    const text =
      `👤 <b>Active Profile: ${p.name} (v${p.version})</b>\n\n` +
      `🎯 <b>Target Titles:</b>\n  ${p.targetTitles.join(', ')}\n\n` +
      `🔑 <b>Required Skills:</b>\n  ${p.requiredSkills.join(', ')}\n\n` +
      `✨ <b>Preferred Skills:</b>\n  ${p.preferredSkills.join(', ')}\n\n` +
      `💼 <b>Employment Types:</b>\n  ${p.employmentTypes.join(', ')}\n\n` +
      `🌐 <b>Work Modes:</b>\n  ${p.workArrangements.join(', ')}\n\n` +
      `⛔ <b>Deal-Breakers:</b>\n  ${p.dealBreakers.join(', ')}\n\n` +
      `📊 <b>Notification Threshold:</b> ${p.minScoreThreshold}/100`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
    });
  };

  bot.command('profile', handleProfile);
  bot.hears('👤 Profile', handleProfile);

  // ── /matches ───────────────────────────────────────────────────────────────
  bot.command('matches', async ctx => {
    const recentMatches = evaluationsRepo.getMatches(5);
    if (recentMatches.length === 0) {
      await ctx.reply('No matches found yet.');
      return;
    }

    const entries = recentMatches
      .map((m, idx) => {
        let reasons: string[] = [];
        try {
          reasons = JSON.parse(m.matchReasons);
        } catch {
          reasons = [];
        }
        return (
          `<b>${idx + 1}. ${m.extractedTitle ?? 'Job Opportunity'}</b>\n` +
          `🏢 Company: ${m.extractedCompany ?? 'Unknown'}\n` +
          `⭐ Score: ${m.score}/100\n` +
          `💡 Top Reason: ${reasons[0] ?? 'Score met threshold'}\n` +
          `🕒 Evaluated: ${m.evaluatedAt}`
        );
      })
      .join('\n\n');

    await ctx.reply(`🎯 <b>Recent Matches:</b>\n\n${entries}`, {
      parse_mode: 'HTML',
    });
  });

  // ── /pause & /resume ───────────────────────────────────────────────────────
  bot.command('pause', async ctx => {
    appStateRepo.set('paused', 'true');
    await ctx.reply(
      '⏸️ <b>Notifications paused.</b> AfriPersonal will not deliver alerts until resumed.',
      {
        parse_mode: 'HTML',
      },
    );
  });

  bot.command('resume', async ctx => {
    appStateRepo.set('paused', 'false');
    await ctx.reply(
      '▶️ <b>Notifications resumed.</b> Active alerts will be processed.',
      {
        parse_mode: 'HTML',
      },
    );
  });

  // ── /stats ─────────────────────────────────────────────────────────────────
  bot.command('stats', async ctx => {
    const pendingCount = messagesRepo.countByStatus('pending');
    const evaluatedCount = messagesRepo.countByStatus('evaluated');
    const skippedCount = messagesRepo.countByStatus('skipped');
    const failedCount = messagesRepo.countByStatus('failed');
    const totalMessages =
      pendingCount + evaluatedCount + skippedCount + failedCount;

    const matches = evaluationsRepo.getMatches(1000).length;
    const queuedNotifs = notificationsRepo.getPending().length;

    const text =
      `📊 <b>AfriPersonal Statistics</b>\n\n` +
      `<b>Messages Processed:</b>\n` +
      `• Total Ingested: ${totalMessages}\n` +
      `• Pending Evaluation: ${pendingCount}\n` +
      `• Evaluated: ${evaluatedCount}\n` +
      `• Skipped: ${skippedCount}\n` +
      `• Processing Failed: ${failedCount}\n\n` +
      `<b>Match Performance:</b>\n` +
      `• Qualified Matches: ${matches}\n` +
      `• Notifications Queued: ${queuedNotifs}`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /import & Direct Message Ingestion ──────────────────────────────────────
  const handleIngestText = async (ctx: Context, rawText: string) => {
    if (!rawText.trim()) {
      await ctx.reply('Please provide job post text to import.');
      return;
    }

    const msgObj = ctx.message as Record<string, unknown> | undefined;
    let postedAt: Date = new Date();
    if (msgObj && typeof msgObj['forward_date'] === 'number') {
      postedAt = new Date((msgObj['forward_date'] as number) * 1000);
    } else if (
      msgObj &&
      typeof msgObj['forward_origin'] === 'object' &&
      msgObj['forward_origin'] !== null &&
      'date' in msgObj['forward_origin'] &&
      typeof (msgObj['forward_origin'] as { date: number }).date === 'number'
    ) {
      postedAt = new Date(
        (msgObj['forward_origin'] as { date: number }).date * 1000,
      );
    }

    const raw = manualAdapter.enqueue({
      text: rawText,
      postedAt,
    });

    const ingestRes = await ingestionService.ingestMessage(raw);
    if (!ingestRes.inserted) {
      if (ingestRes.reason === 'duplicate_external_id') {
        await ctx.reply('ℹ️ This post has already been imported previously.');
      } else {
        await ctx.reply(`⚠️ Failed to import post: ${ingestRes.error}`);
      }
      return;
    }

    // Evaluate immediately against active profile
    const activeRow = profileRepo.getActive();
    if (!activeRow) {
      await ctx.reply(
        '✅ Post saved to database (no active profile to evaluate against).',
      );
      return;
    }

    const profile = profileFromDb(activeRow);
    const evalRes = evaluate(rawText, profile);

    const evalRow = evaluationsRepo.insert({
      messageId: ingestRes.message!.id,
      profileVersion: profile.version,
      ruleEngineVersion: evalRes.ruleEngineVersion,
      isJobAnnouncement: evalRes.isJobAnnouncement,
      extractedTitle: evalRes.extracted.title,
      extractedCompany: evalRes.extracted.company,
      extractedLocation: evalRes.extracted.location,
      extractedWorkMode: evalRes.extracted.workMode,
      extractedEmploymentType: evalRes.extracted.employmentType,
      extractedDeadline: evalRes.extracted.deadline,
      extractedApplyMethod: evalRes.extracted.applyMethod,
      matchedSkills: evalRes.matchedSkills,
      matchedRoles: evalRes.matchedRoles,
      missingInfo: evalRes.missingInfo,
      triggeredExclusions: evalRes.triggeredExclusions,
      score: evalRes.score,
      verdict: evalRes.verdict,
      matchReasons: evalRes.matchReasons,
    });

    messagesRepo.updateStatus(
      ingestRes.message!.id,
      evalRes.verdict === 'skipped' ? 'skipped' : 'evaluated',
    );

    if (evalRes.verdict === 'match') {
      const notif = notificationsRepo.queue(evalRow.id);
      await ctx.reply(
        `🎉 <b>Match Found! (Score: ${evalRes.score}/100)</b>\n` +
          `Title: ${evalRes.extracted.title ?? 'Job Post'}\n` +
          `Queued notification #${notif.id}.`,
        { parse_mode: 'HTML' },
      );
    } else if (evalRes.verdict === 'excluded') {
      await ctx.reply(
        `🚫 <b>Excluded by Deal-Breaker:</b>\n` +
          `${evalRes.triggeredExclusions.join(', ') || 'Deal-breaker triggered.'}`,
        { parse_mode: 'HTML' },
      );
    } else if (evalRes.verdict === 'skipped') {
      await ctx.reply(
        'ℹ️ Message does not appear to be an English job announcement — skipped.',
      );
    } else {
      await ctx.reply(
        `ℹ️ <b>Evaluated — No Match (Score: ${evalRes.score}/100)</b>\n` +
          `Threshold is ${profile.minScoreThreshold}/100.`,
        { parse_mode: 'HTML' },
      );
    }
  };

  bot.command('import', async ctx => {
    const text = ctx.match;
    await handleIngestText(ctx, text);
  });

  bot.on('message:text', async ctx => {
    // If it's not a command, treat as forwarded/pasted job post
    if (ctx.message.text.startsWith('/')) return;
    await handleIngestText(ctx, ctx.message.text);
  });

  // ── Inline Feedback & Action Callback Queries ─────────────────────────────
  bot.on('callback_query:data', async ctx => {
    const data = ctx.callbackQuery.data;

    if (data === 'action:fetch50') {
      await ctx.answerCallbackQuery({ text: 'Starting 50 post scan...' });
      await handleFetch50(ctx);
      return;
    }

    if (data === 'confirm:cancel') {
      await ctx.answerCallbackQuery({ text: 'Action cancelled' });
      try {
        await ctx.deleteMessage();
      } catch {
        await ctx.editMessageText('❌ Cancelled.');
      }
      return;
    }

    if (data === 'confirm:clear' || data === 'action:clear') {
      await ctx.answerCallbackQuery({ text: 'Conversation cleared' });
      const currentMsgId = ctx.callbackQuery.message?.message_id;
      await clearAllChatMessages(ownerChatId, currentMsgId);
      await bot.api.sendMessage(ownerChatId, '🧹 <b>Chat cleared.</b>', {
        parse_mode: 'HTML',
        reply_markup: removeKeyboardMarkup,
      });
      return;
    }

    if (!data.startsWith('feedback:')) return;

    const [, notifIdStr, rating] = data.split(':');
    const notifId = parseInt(notifIdStr ?? '', 10);

    if (
      isNaN(notifId) ||
      !rating ||
      !['relevant', 'not_relevant', 'applied'].includes(rating)
    ) {
      await ctx.answerCallbackQuery({ text: 'Invalid feedback action.' });
      return;
    }

    feedbackRepo.insert(
      notifId,
      rating as 'relevant' | 'not_relevant' | 'applied',
    );

    const labels: Record<string, string> = {
      relevant: '👍 Marked as Relevant',
      not_relevant: '👎 Marked as Not Relevant',
      applied: '💼 Marked as Applied',
    };

    await ctx.answerCallbackQuery({
      text: labels[rating] ?? 'Feedback recorded!',
    });
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // Ignore if markup cannot be cleared
    }
  });

  return bot;
}
