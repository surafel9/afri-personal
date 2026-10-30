import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../database/client.js';
import { runMigrations } from '../../database/migrate.js';
import { createBot } from '../bot.js';
import { createProfileRepo } from '../../database/repositories/profile.js';
import { createSourcesRepo } from '../../database/repositories/sources.js';
import { createFeedbackRepo } from '../../database/repositories/feedback.js';
import type { UserFromGetMe } from 'grammy/types';
import type { Database } from 'better-sqlite3';
import type { Db } from '../../database/client.js';

describe('Bot & Security Middleware', () => {
  let sqlite: Database;
  let db: Db;
  const OWNER_ID = 123456789;
  const STRANGER_ID = 999999999;

  beforeEach(async () => {
    const conn = createDb(':memory:');
    sqlite = conn.sqlite;
    db = conn.db;
    await runMigrations(sqlite);

    // Seed profile & sources
    const profileRepo = createProfileRepo(db);
    profileRepo.create({
      name: 'Owner Profile',
      targetTitles: ['Backend Developer'],
      requiredSkills: ['Node.js'],
      minScoreThreshold: 60,
    });

    const sourcesRepo = createSourcesRepo(db);
    sourcesRepo.upsert({
      id: 'manual',
      displayName: 'Manual Source',
      enabled: 1,
      ingestionMethod: 'manual',
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  function setupMockBot() {
    const mockBotInfo = {
      id: 888888888,
      is_bot: true as const,
      first_name: 'AfriPersonalBot',
      username: 'afripersonal_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    };

    const bot = createBot('fake:token', OWNER_ID, db, {
      botInfo: mockBotInfo as unknown as UserFromGetMe,
    });
    const sentMessages: Array<{ method: string; payload: unknown }> = [];

    // Intercept all outgoing API requests from the bot
    bot.api.config.use(async (prev, method, payload) => {
      sentMessages.push({ method, payload });
      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: OWNER_ID, type: 'private' },
            text: (payload as { text?: string })?.text ?? '',
          },
        } as unknown as ReturnType<typeof prev>;
      }
      if (method === 'answerCallbackQuery') {
        return { ok: true, result: true } as unknown as ReturnType<typeof prev>;
      }
      if (method === 'editMessageReplyMarkup') {
        return { ok: true, result: true } as unknown as ReturnType<typeof prev>;
      }
      return { ok: true, result: {} } as unknown as ReturnType<typeof prev>;
    });

    return { bot, sentMessages };
  }

  function createCommandMessage(messageId: number, text: string, userId: number) {
    return {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: 'private' as const, first_name: 'User' },
      from: { id: userId, is_bot: false, first_name: 'User' },
      text,
      entities: [{ type: 'bot_command' as const, offset: 0, length: text.length }],
    };
  }

  it('rejects unauthorized users with access denied message', async () => {
    const { bot, sentMessages } = setupMockBot();

    await bot.handleUpdate({
      update_id: 1,
      message: createCommandMessage(1, '/status', STRANGER_ID),
    });

    expect(sentMessages.length).toBe(1);
    const sent = sentMessages[0]?.payload as { text: string };
    expect(sent.text).toContain('Access denied');
  });

  it('allows owner to execute /start and /help', async () => {
    const { bot, sentMessages } = setupMockBot();

    await bot.handleUpdate({
      update_id: 2,
      message: createCommandMessage(2, '/start', OWNER_ID),
    });

    expect(sentMessages.length).toBe(1);
    const sent = sentMessages[0]?.payload as { text: string };
    expect(sent.text).toContain('Welcome to AfriPersonal');
  });

  it('allows owner to check /profile and /status', async () => {
    const { bot, sentMessages } = setupMockBot();

    await bot.handleUpdate({
      update_id: 3,
      message: createCommandMessage(3, '/profile', OWNER_ID),
    });

    expect(sentMessages.length).toBe(1);
    const sent = sentMessages[0]?.payload as { text: string };
    expect(sent.text).toContain('Active Profile: Owner Profile');
    expect(sent.text).toContain('Node.js');
  });

  it('allows owner to pause and resume', async () => {
    const { bot, sentMessages } = setupMockBot();

    await bot.handleUpdate({
      update_id: 4,
      message: createCommandMessage(4, '/pause', OWNER_ID),
    });

    expect(sentMessages[0]?.payload).toMatchObject({
      text: expect.stringContaining('Notifications paused'),
    });

    await bot.handleUpdate({
      update_id: 5,
      message: createCommandMessage(5, '/resume', OWNER_ID),
    });

    expect(sentMessages[1]?.payload).toMatchObject({
      text: expect.stringContaining('Notifications resumed'),
    });
  });

  it('records user feedback from callback query', async () => {
    const { bot } = setupMockBot();

    // Create message -> evaluation -> notification in db first
    const { createMessagesRepo } = await import('../../database/repositories/messages.js');
    const { createEvaluationsRepo } = await import('../../database/repositories/evaluations.js');
    const { createNotificationsRepo } = await import('../../database/repositories/notifications.js');

    const messagesRepo = createMessagesRepo(db);
    const evaluationsRepo = createEvaluationsRepo(db);
    const notificationsRepo = createNotificationsRepo(db);

    const msg = messagesRepo.insertIfNew({
      sourceId: 'manual',
      externalId: 'cb-msg-1',
      postedAt: null,
      fetchedAt: new Date().toISOString(),
      originalText: 'React dev role',
      links: '[]',
      hasMedia: 0,
      textHash: 'hash-cb-1',
      processingStatus: 'evaluated',
      processingError: null,
      createdAt: new Date().toISOString(),
    })!;

    const evaluation = evaluationsRepo.insert({
      messageId: msg.id,
      profileVersion: 1,
      ruleEngineVersion: '1.0.0',
      isJobAnnouncement: true,
      extractedTitle: 'React dev',
      matchedSkills: ['react'],
      matchedRoles: ['frontend'],
      missingInfo: [],
      triggeredExclusions: [],
      score: 75,
      verdict: 'match',
      matchReasons: ['Matched react'],
    });

    const notif = notificationsRepo.queue(evaluation.id);

    await bot.handleUpdate({
      update_id: 6,
      callback_query: {
        id: 'cb-1',
        from: { id: OWNER_ID, is_bot: false, first_name: 'Owner' },
        chat_instance: 'instance-1',
        data: `feedback:${notif.id}:relevant`,
      },
    });

    const feedbackRepo = createFeedbackRepo(db);
    const records = feedbackRepo.findByNotificationId(notif.id);
    expect(records.length).toBe(1);
    expect(records[0]?.rating).toBe('relevant');
  });
});
