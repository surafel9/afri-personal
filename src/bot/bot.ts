/**
 * bot.ts
 * Telegram bot implementation using grammY.
 * Enforces strict single-owner security, provides operational commands,
 * handles forwarded/manual message import, and records user feedback.
 */

import { Bot, Context, type BotConfig } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Db } from '../database/client.js';
import { createSourcesRepo } from '../database/repositories/sources.js';
import { createProfileRepo } from '../database/repositories/profile.js';
import { createEvaluationsRepo } from '../database/repositories/evaluations.js';
import { createMessagesRepo } from '../database/repositories/messages.js';
import { createNotificationsRepo } from '../database/repositories/notifications.js';
import { createFeedbackRepo } from '../database/repositories/feedback.js';
import { createAppStateRepo } from '../database/repositories/app-state.js';
import { IngestionService } from '../pipeline/ingestion.js';
import { ManualImportAdapter } from '../sources/manual-adapter.js';
import { evaluate, profileFromDb } from '../matching/engine.js';
import { logger } from '../observability/logger.js';

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
      `I am your personal, private job-matching assistant.\n` +
      `I evaluate job posts deterministically against your career profile and send you only the relevant opportunities.\n\n` +
      `<b>Available Commands:</b>\n` +
      `• /status — Check pipeline status and queues\n` +
      `• /profile — View your active matching profile\n` +
      `• /matches — View recent matched jobs\n` +
      `• /sources — List configured sources\n` +
      `• /stats — View processing and matching statistics\n` +
      `• /pause — Pause notifications and processing\n` +
      `• /resume — Resume processing\n` +
      `• /help — Full usage and import instructions\n\n` +
      `💡 <i>Tip: Forward any job post directly to this chat to evaluate it immediately!</i>`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /help ──────────────────────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    const text =
      `📖 <b>AfriPersonal Help & Usage</b>\n\n` +
      `<b>How Job Ingestion Works:</b>\n` +
      `1. <b>Forward posts:</b> Forward any post from a job channel directly to this bot.\n` +
      `2. <b>Paste text:</b> Send or paste raw job announcements into this chat.\n` +
      `3. <b>Command:</b> Use <code>/import &lt;job text&gt;</code> to import.\n\n` +
      `<b>The Matching Engine:</b>\n` +
      `• 100% deterministic rule-based evaluation (no external LLMs or data leaks).\n` +
      `• Normalizes technologies and aliases (e.g. Node.js, React, TypeScript).\n` +
      `• Filters out promos, ads, and deal-breakers.\n` +
      `• Explains exact reasons why an opportunity qualifies.\n\n` +
      `<b>Operational Commands:</b>\n` +
      `/status — Operational health and queue depths\n` +
      `/profile — Active career preferences and criteria\n` +
      `/matches — Recent matched evaluations\n` +
      `/sources — Monitored source adapters\n` +
      `/stats — Aggregated metrics\n` +
      `/pause — Temporarily halt notifications\n` +
      `/resume — Unpause notifications`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /status ────────────────────────────────────────────────────────────────
  bot.command('status', async (ctx) => {
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

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /sources ───────────────────────────────────────────────────────────────
  bot.command('sources', async (ctx) => {
    const list = sourcesRepo.findAll();
    if (list.length === 0) {
      await ctx.reply('No sources configured.');
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
    });
  });

  // ── /profile ───────────────────────────────────────────────────────────────
  bot.command('profile', async (ctx) => {
    const activeRow = profileRepo.getActive();
    if (!activeRow) {
      await ctx.reply('No active profile found in database.');
      return;
    }

    const p = profileFromDb(activeRow);
    const text =
      `👤 <b>Active Profile: ${p.name}</b> (v${p.version})\n\n` +
      `🎯 <b>Target Titles:</b>\n  ${p.targetTitles.join(', ') || 'Any'}\n\n` +
      `🔑 <b>Required Skills:</b>\n  ${p.requiredSkills.join(', ') || 'None'}\n\n` +
      `✨ <b>Preferred Skills:</b>\n  ${p.preferredSkills.join(', ') || 'None'}\n\n` +
      `💼 <b>Employment Types:</b>\n  ${p.employmentTypes.join(', ') || 'Any'}\n\n` +
      `🌐 <b>Work Modes:</b>\n  ${p.workArrangements.join(', ') || 'Any'}\n\n` +
      `⛔ <b>Deal-Breakers:</b>\n  ${p.dealBreakers.join(', ') || 'None'}\n\n` +
      `📊 <b>Notification Threshold:</b> ${p.minScoreThreshold}/100`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

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

  // ── Inline Feedback Callback Queries ───────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
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
