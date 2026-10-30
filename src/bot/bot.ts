/**
 * bot.ts
 * Telegram bot implementation using grammY.
 * Enforces strict single-owner security, provides operational commands,
 * handles forwarded/manual message import, and records user feedback.
 */

import { Bot, Context, Keyboard, InlineKeyboard, type BotConfig } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
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

export const persistentControlKeyboard = new Keyboard()
  .text('📥 Fetch 50 Recent Jobs')
  .row()
  .text('🧹 Clear Chat')
  .text('🔄 Wipe & Restart')
  .row()
  .text('📊 Status')
  .text('👤 Profile')
  .resized()
  .persistent();

export function createBot(
  token: string,
  ownerChatId: number,
  db: Db,
  botConfig?: BotConfig<Context>,
): Bot {
  const bot = new Bot(token, botConfig);

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
        await ctx.reply('⛔ Access denied. AfriPersonal is a private, single-user assistant.');
      }
      return;
    }
    await next();
  });

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const text =
      `👋 <b>Welcome to AfriPersonal!</b>\n\n` +
      `Your automated technical job watcher is active.\n` +
      `I monitor <b>@freelance_ethio</b>, strictly filter for <b>technical titles only</b>, and forward matches verbatim.\n\n` +
      `Click <b>📥 Fetch 50 Recent Jobs</b> below at any time to instantly screen the latest posts.\n\n` +
      `<b>Quick Actions (Permanent Keyboard Below):</b>\n` +
      `• <b>📥 Fetch 50 Recent Jobs</b> — Scan the latest 50 posts immediately\n` +
      `• <b>🧹 Clear Chat</b> — Delete job alerts from this chat\n` +
      `• <b>🔄 Wipe & Restart</b> — Fresh start & clean re-fetch\n` +
      `• <b>📊 Status</b> — Check pipeline and source status\n` +
      `• <b>👤 Profile</b> — View your active career profile`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: persistentControlKeyboard,
    });
  });

  // ── Helper: Delete sent notification messages from Telegram chat ────────────
  async function clearSentChatMessages(statusMsgId?: number): Promise<number> {
    const allNotifs = db.select().from(notifications).all();
    let deleted = 0;

    for (const notif of allNotifs) {
      if (notif.telegramMessageId && notif.telegramMessageId !== statusMsgId) {
        try {
          await bot.api.deleteMessage(ownerChatId, notif.telegramMessageId);
          deleted++;
        } catch {
          // Ignore already deleted or expired messages
        }
      }
    }

    db.delete(notifications).run();
    return deleted;
  }

  // ── /clear ─────────────────────────────────────────────────────────────────
  const handleClear = async (ctx: Context) => {
    const progress = await ctx.reply('🧹 Deleting sent job messages from this chat...', {
      reply_markup: persistentControlKeyboard,
    });
    const count = await clearSentChatMessages(progress.message_id);
    await ctx.reply(`✅ <b>Cleaned!</b> Deleted ${count} job messages from chat and reset delivery queue.`, {
      parse_mode: 'HTML',
      reply_markup: persistentControlKeyboard,
    });
  };

  bot.command('clear', handleClear);
  bot.hears('🧹 Clear Chat', handleClear);

  // ── /restart ───────────────────────────────────────────────────────────────
  const handleRestart = async (ctx: Context) => {
    const progress = await ctx.reply('🔄 Wiping database and cleaning chat for fresh restart...', {
      reply_markup: persistentControlKeyboard,
    });
    const count = await clearSentChatMessages(progress.message_id);

    // Wipe all processing and evaluation records
    db.delete(evaluations).run();
    db.delete(jobs).run();
    db.delete(feedback).run();
    db.delete(sourceMessages).run();
    appStateRepo.delete('checkpoint:telegram-web:freelance_ethio');

    await ctx.reply(
      `✅ <b>Full Reset Complete!</b>\n\n` +
      `• Deleted ${count} previous job alerts from this chat\n` +
      `• Wiped stored messages, evaluations, and job history\n` +
      `• Reset channel checkpoint to 0\n\n` +
      `Ready! Click <b>📥 Fetch 50 Recent Jobs</b> below to scan freshly.`,
      { parse_mode: 'HTML', reply_markup: persistentControlKeyboard },
    );
  };

  bot.command('restart', handleRestart);
  bot.hears('🔄 Wipe & Restart', handleRestart);

  // ── /fetch50 — On-demand 50 recent posts fetcher ───────────────────────────
  const handleFetch50 = async (ctx: Context) => {
    await ctx.reply('⏳ <b>Fetching and screening the 50 most recent posts from @freelance_ethio...</b>', {
      parse_mode: 'HTML',
      reply_markup: persistentControlKeyboard,
    });

    try {
      const channelUrl = config.TELEGRAM_CHANNEL_URL ?? 'https://t.me/s/freelance_ethio';
      const adapter = new TelegramWebAdapter(channelUrl, db);
      const rawPosts = await adapter.fetchRecent(50);

      const activeProfileRow = profileRepo.getActive();
      if (!activeProfileRow) {
        await ctx.reply('⚠️ No active profile found.', {
          reply_markup: persistentControlKeyboard,
        });
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
          logger.warn({ raw }, 'Could not resolve message row for on-demand fetch');
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

          const { text, keyboard } = formatVerbatim(raw.text, raw.links, notif.id);

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
        {
          parse_mode: 'HTML',
          reply_markup: persistentControlKeyboard,
        },
      );
    } catch (err) {
      logger.error({ err }, 'Error during on-demand 50 fetch');
      await ctx.reply('⚠️ Error fetching posts from channel. Please check your internet connection and try again.', {
        reply_markup: persistentControlKeyboard,
      });
    }
  };

  bot.command('fetch50', handleFetch50);
  bot.hears('📥 Fetch 50 Recent Jobs', handleFetch50);

  // ── /help ──────────────────────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    const text =
      `📖 <b>AfriPersonal Help & Usage</b>\n\n` +
      `<b>100% Automated Job Watcher:</b>\n` +
      `• <b>Channel Polling:</b> Automatically monitors @freelance_ethio every 15 minutes.\n` +
      `• <b>Zero Manual Work:</b> You never need to browse channels or copy/paste posts.\n` +
      `• <b>Strict Title Filter:</b> Only genuine tech titles (Developer, Software, Engineer, Fullstack, Mobile, DevOps, UI/UX, etc.) are matched.\n` +
      `• <b>Verbatim Delivery:</b> Sends the exact original post with direct link to your DM.\n\n` +
      `<b>Commands:</b>\n` +
      `• /clear — Delete all sent job alert messages from this chat\n` +
      `• /restart — Fully wipe data, clear messages, and restart clean\n` +
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
    const pendingCount = messagesRepo.countByStatus('pending');
    const pendingNotifs = notificationsRepo.getPending().length;
    const sources = sourcesRepo.findAll();

    const sourcesSummary = sources
      .map(
        (s) =>
          `  • <b>${s.displayName}</b> (${s.enabled ? '🟢 enabled' : '🔴 disabled'}):\n` +
          `    Last success: ${s.lastSuccessAt ?? 'never'}\n` +
          (s.lastErrorMsg ? `    ⚠️ Last error: ${s.lastErrorMsg}\n` : ''),
      )
      .join('\n');

    const text =
      `⚙️ <b>AfriPersonal Status</b>\n\n` +
      `• <b>State:</b> ${paused ? '⏸️ PAUSED' : '▶️ RUNNING'}\n` +
      `• <b>Pending messages to evaluate:</b> ${pendingCount}\n` +
      `• <b>Queued notifications:</b> ${pendingNotifs}\n\n` +
      `<b>Configured Sources:</b>\n${sourcesSummary || '  None'}`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: persistentControlKeyboard,
    });
  };

  bot.command('status', handleStatus);
  bot.hears('📊 Status', handleStatus);

  // ── /sources ───────────────────────────────────────────────────────────────
  bot.command('sources', async (ctx) => {
    const list = sourcesRepo.findAll();
    if (list.length === 0) {
      await ctx.reply('No sources configured.', {
        reply_markup: persistentControlKeyboard,
      });
      return;
    }

    const items = list
      .map(
        (s) =>
          `📌 <b>${s.displayName}</b> [<code>${s.id}</code>]\n` +
          `• Method: ${s.ingestionMethod}\n` +
          `• Status: ${s.enabled ? '✅ Active' : '⏸️ Inactive'}\n` +
          `• Last Retrieval: ${s.lastSuccessAt ? s.lastSuccessAt : 'Never'}\n` +
          (s.lastErrorMsg ? `• ⚠️ Error: ${s.lastErrorMsg}\n` : ''),
      )
      .join('\n\n');

    await ctx.reply(`📡 <b>Configured Sources:</b>\n\n${items}`, {
      parse_mode: 'HTML',
      reply_markup: persistentControlKeyboard,
    });
  });

  // ── /profile ───────────────────────────────────────────────────────────────
  const handleProfile = async (ctx: Context) => {
    const activeRow = profileRepo.getActive();
    if (!activeRow) {
      await ctx.reply('⚠️ No active profile found.', {
        reply_markup: persistentControlKeyboard,
      });
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
      reply_markup: persistentControlKeyboard,
    });
  };

  bot.command('profile', handleProfile);
  bot.hears('👤 Profile', handleProfile);

  // ── /matches ───────────────────────────────────────────────────────────────
  bot.command('matches', async (ctx) => {
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
  bot.command('pause', async (ctx) => {
    appStateRepo.set('paused', 'true');
    await ctx.reply('⏸️ <b>Notifications paused.</b> AfriPersonal will not deliver alerts until resumed.', {
      parse_mode: 'HTML',
    });
  });

  bot.command('resume', async (ctx) => {
    appStateRepo.set('paused', 'false');
    await ctx.reply('▶️ <b>Notifications resumed.</b> Active alerts will be processed.', {
      parse_mode: 'HTML',
    });
  });

  // ── /stats ─────────────────────────────────────────────────────────────────
  bot.command('stats', async (ctx) => {
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
      postedAt = new Date((msgObj['forward_origin'] as { date: number }).date * 1000);
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
      await ctx.reply('✅ Post saved to database (no active profile to evaluate against).');
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
      await ctx.reply('ℹ️ Message does not appear to be an English job announcement — skipped.');
    } else {
      await ctx.reply(
        `ℹ️ <b>Evaluated — No Match (Score: ${evalRes.score}/100)</b>\n` +
        `Threshold is ${profile.minScoreThreshold}/100.`,
        { parse_mode: 'HTML' },
      );
    }
  };

  bot.command('import', async (ctx) => {
    const text = ctx.match;
    await handleIngestText(ctx, text);
  });

  bot.on('message:text', async (ctx) => {
    // If it's not a command, treat as forwarded/pasted job post
    if (ctx.message.text.startsWith('/')) return;
    await handleIngestText(ctx, ctx.message.text);
  });

  // ── Inline Feedback & Action Callback Queries ─────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === 'action:fetch50') {
      await ctx.answerCallbackQuery({ text: 'Starting 50 post scan...' });
      await handleFetch50(ctx);
      return;
    }

    // Handle button actions: Clear
    if (data === 'action:clear') {
      await ctx.answerCallbackQuery({ text: 'Clearing messages...' });
      const count = await clearSentChatMessages(ctx.callbackQuery.message?.message_id);
      await ctx.reply(`✅ Deleted ${count} job messages from chat.`, {
        parse_mode: 'HTML',
        reply_markup: persistentControlKeyboard,
      });
      return;
    }

    // Handle button actions: Restart
    if (data === 'action:restart') {
      await ctx.answerCallbackQuery({ text: 'Wiping database and resetting...' });
      const count = await clearSentChatMessages(ctx.callbackQuery.message?.message_id);
      db.delete(evaluations).run();
      db.delete(jobs).run();
      db.delete(feedback).run();
      db.delete(sourceMessages).run();
      appStateRepo.delete('checkpoint:telegram-web:freelance_ethio');

      await ctx.reply(
        `✅ <b>Reset Complete!</b> Cleared ${count} messages and wiped database. Ready for a clean start.`,
        { parse_mode: 'HTML', reply_markup: persistentControlKeyboard },
      );
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

    await ctx.answerCallbackQuery({ text: labels[rating] ?? 'Feedback recorded!' });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch {
      // Ignore if markup cannot be cleared
    }
  });

  return bot;
}
