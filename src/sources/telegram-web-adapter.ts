/**
 * telegram-web-adapter.ts
 *
 * SourceAdapter that polls a public Telegram channel's web preview page
 * (https://t.me/s/<channel>) and parses job posts from the HTML.
 *
 * Strategy:
 *  - First run (no checkpoint): fetches up to the last 50 posts (backfill).
 *  - Subsequent runs: fetches only posts newer than the stored checkpoint
 *    (last seen message ID), stored in app_state as `checkpoint:<sourceId>`.
 *
 * Cloudflare mitigation:
 *  - Sends a realistic browser User-Agent header.
 *  - On any non-200 response or network error, logs a warning and yields
 *    nothing — the bot does not crash, it just skips that cycle.
 *
 * HTML contract (t.me/s/ as of 2024-2026):
 *  - Each message lives in a <div class="tgme_widget_message_wrap"> element.
 *  - The message ID is in the data-post attribute of the inner
 *    .tgme_widget_message div: e.g. data-post="freelance_ethio/1234"
 *  - Post text is in .tgme_widget_message_text
 *  - Timestamp is in <time datetime="...">
 *  - Links are <a href="..."> elements inside the message text.
 *
 * If the HTML structure changes, parsing yields 0 messages and logs an error.
 */

import type { RawMessage, SourceAdapter } from './types.js';
import { createAppStateRepo } from '../database/repositories/app-state.js';
import type { Db } from '../database/client.js';
import { logger } from '../observability/logger.js';

// How many posts to fetch on the very first run (backfill).
const BACKFILL_LIMIT = 50;

// Realistic browser User-Agent to avoid Cloudflare challenges.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** A single parsed message from the channel HTML. */
interface ParsedPost {
  messageId: string;  // numeric string, e.g. "1234"
  postedAt: Date | null;
  text: string;
  links: string[];
}

export class TelegramWebAdapter implements SourceAdapter {
  readonly sourceId: string;
  readonly displayName: string;

  private readonly channelUrl: string;
  private readonly appStateRepo: ReturnType<typeof createAppStateRepo>;

  /**
   * @param channelUrl  Full URL to the t.me/s/ preview page.
   *                    e.g. "https://t.me/s/freelance_ethio"
   * @param db          Database handle for checkpoint persistence.
   */
  constructor(channelUrl: string, db: Db) {
    this.channelUrl = channelUrl.replace(/\/$/, ''); // strip trailing slash
    // Derive a stable sourceId from the channel name, e.g. "telegram-web:freelance_ethio"
    const channelName = this.channelUrl.split('/').pop() ?? 'unknown';
    this.sourceId = `telegram-web:${channelName}`;
    this.displayName = `Telegram Web Channel (${channelName})`;
    this.appStateRepo = createAppStateRepo(db);
  }

  /**
   * Fetch new posts from the channel.
   * Yields RawMessage objects for each post that hasn't been seen before.
   */
  async *fetchNew(): AsyncIterable<RawMessage> {
    const checkpointKey = `checkpoint:${this.sourceId}`;
    const lastSeenId = this.appStateRepo.get(checkpointKey);
    const isFirstRun = lastSeenId === undefined;

    logger.info(
      { sourceId: this.sourceId, isFirstRun, lastSeenId: lastSeenId ?? null },
      'TelegramWebAdapter: starting fetch',
    );

    // Add small random jitter so consecutive restarts don't hit at the same second.
    const jitterMs = Math.floor(Math.random() * 5000);
    await sleep(jitterMs);

    const allPosts: ParsedPost[] = [];
    const html = await this.fetchPage(this.channelUrl);
    if (html !== null) {
      allPosts.push(...parsePosts(html));
    }

    if (allPosts.length === 0) {
      logger.warn(
        { sourceId: this.sourceId, url: this.channelUrl },
        'TelegramWebAdapter: no posts parsed from page (HTML structure may have changed)',
      );
      return;
    }

    // On first run (backfill mode), paginate backwards using ?before=<minId>
    // until we collect at least BACKFILL_LIMIT (50) posts.
    if (isFirstRun) {
      while (allPosts.length < BACKFILL_LIMIT) {
        const minId = Math.min(...allPosts.map((p) => numericId(p.messageId)));
        if (!isFinite(minId) || minId <= 1) break;

        await sleep(1000);
        const olderUrl = `${this.channelUrl}?before=${minId}`;
        const olderHtml = await this.fetchPage(olderUrl);
        if (!olderHtml) break;

        const olderPosts = parsePosts(olderHtml);
        if (olderPosts.length === 0) break;

        const newOlderPosts = olderPosts.filter(
          (op) => !allPosts.some((p) => p.messageId === op.messageId),
        );
        if (newOlderPosts.length === 0) break;

        allPosts.push(...newOlderPosts);
      }
    }

    logger.debug(
      { sourceId: this.sourceId, totalParsed: allPosts.length },
      'TelegramWebAdapter: parsed posts from HTML',
    );

    // Sort ascending by message ID so we process oldest→newest.
    const sorted = allPosts.sort((a, b) => numericId(a.messageId) - numericId(b.messageId));

    // Determine which posts to yield.
    const fetchedAt = new Date();
    let yielded = 0;

    for (const post of sorted) {
      // Incremental mode: skip anything at or before the last seen checkpoint.
      if (!isFirstRun && numericId(post.messageId) <= numericId(lastSeenId!)) {
        continue;
      }

      // Backfill mode: only yield the last BACKFILL_LIMIT posts.
      if (isFirstRun && sorted.length > BACKFILL_LIMIT) {
        const startIndex = sorted.length - BACKFILL_LIMIT;
        if (sorted.indexOf(post) < startIndex) {
          continue;
        }
      }

      const channelName = this.channelUrl.split('/').pop() ?? 'freelance_ethio';
      const postUrl = `https://t.me/${channelName}/${post.messageId}`;
      const uniqueLinks = [
        postUrl,
        ...post.links.filter(
          (l) =>
            l !== postUrl &&
            !l.endsWith(`/${channelName}`) &&
            !l.endsWith(`/${channelName}/`),
        ),
      ];

      yield {
        sourceId: this.sourceId,
        externalId: post.messageId,
        postedAt: post.postedAt,
        fetchedAt,
        text: post.text,
        links: uniqueLinks,
        hasMedia: false, // web preview does not expose media reliably
      };

      yielded++;
    }

    logger.info(
      { sourceId: this.sourceId, yielded, totalParsed: allPosts.length },
      'TelegramWebAdapter: fetch complete',
    );
  }

  /**
   * Fetch the most recent N posts on-demand, bypassing checkpoints.
   * Useful for interactive /fetch50 checks.
   */
  async fetchRecent(limit = 50): Promise<RawMessage[]> {
    const allPosts: ParsedPost[] = [];
    const html = await this.fetchPage(this.channelUrl);
    if (html !== null) {
      allPosts.push(...parsePosts(html));
    }

    while (allPosts.length < limit) {
      const minId = Math.min(...allPosts.map((p) => numericId(p.messageId)));
      if (!isFinite(minId) || minId <= 1) break;

      await sleep(800);
      const olderUrl = `${this.channelUrl}?before=${minId}`;
      const olderHtml = await this.fetchPage(olderUrl);
      if (!olderHtml) break;

      const olderPosts = parsePosts(olderHtml);
      if (olderPosts.length === 0) break;

      const newOlderPosts = olderPosts.filter(
        (op) => !allPosts.some((p) => p.messageId === op.messageId),
      );
      if (newOlderPosts.length === 0) break;

      allPosts.push(...newOlderPosts);
    }

    const sorted = allPosts.sort((a, b) => numericId(a.messageId) - numericId(b.messageId));
    const target = sorted.slice(-limit);
    const fetchedAt = new Date();

    return target.map((post) => ({
      sourceId: this.sourceId,
      externalId: post.messageId,
      postedAt: post.postedAt,
      fetchedAt,
      text: post.text,
      links: post.links,
      hasMedia: false,
    }));
  }

  /**
   * Fetch the channel preview page HTML.
   * Returns null on any network or HTTP error (caller skips gracefully).
   */
  private async fetchPage(url = this.channelUrl): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(30_000), // 30s timeout
      });

      if (!response.ok) {
        logger.warn(
          { sourceId: this.sourceId, status: response.status, url },
          'TelegramWebAdapter: non-200 response — skipping cycle',
        );
        return null;
      }

      return await response.text();
    } catch (err) {
      logger.warn(
        { sourceId: this.sourceId, err, url },
        'TelegramWebAdapter: network error — skipping cycle',
      );
      return null;
    }
  }
}

// ── HTML Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse all posts from the t.me/s/ preview page HTML.
 * Uses simple regex-based extraction — no DOM parser dependency.
 */
export function parsePosts(html: string): ParsedPost[] {
  const posts: ParsedPost[] = [];

  // Each message block: <div class="tgme_widget_message_wrap ...">...</div>
  // We split on the wrapper and process each block individually.
  const wrapperRe = /<div[^>]+class="[^"]*tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*tgme_widget_message_wrap|$)/g;
  let wrapperMatch: RegExpExecArray | null;

  while ((wrapperMatch = wrapperRe.exec(html)) !== null) {
    const block = wrapperMatch[0];

    const messageId = extractMessageId(block);
    if (!messageId) continue;

    const text = extractText(block);
    if (!text || text.trim().length === 0) continue;

    const postedAt = extractTimestamp(block);
    const links = extractLinks(block);

    posts.push({ messageId, postedAt, text: text.trim(), links });
  }

  return posts;
}

/** Extract the numeric message ID from a block, e.g. data-post="channel/1234" → "1234" */
function extractMessageId(block: string): string | null {
  const match = /data-post="[^/]+\/(\d+)"/.exec(block);
  return match ? match[1]! : null;
}

/** Extract and clean post text from .tgme_widget_message_text */
function extractText(block: string): string | null {
  // Capture content inside the message text div
  const divMatch = /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
  if (!divMatch) return null;

  let inner = divMatch[1]!;

  // Replace <br>, <br/> with newlines
  inner = inner.replace(/<br\s*\/?>/gi, '\n');

  // Replace block-level tags with newlines
  inner = inner.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');

  // Strip all remaining HTML tags
  inner = inner.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  inner = decodeEntities(inner);

  // Collapse 3+ consecutive newlines into 2
  inner = inner.replace(/\n{3,}/g, '\n\n');

  return inner;
}

/** Extract the post timestamp from <time datetime="..."> */
function extractTimestamp(block: string): Date | null {
  const match = /datetime="([^"]+)"/.exec(block);
  if (!match) return null;
  const d = new Date(match[1]!);
  return isNaN(d.getTime()) ? null : d;
}

/** Extract all href links from the message text, excluding Telegram-internal UI links. */
function extractLinks(block: string): string[] {
  const textDivMatch =
    /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      block,
    );
  const target = textDivMatch ? textDivMatch[1]! : block;

  const links: string[] = [];
  const linkRe = /href="(https?:\/\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(target)) !== null) {
    const url = m[1]!;
    // Skip Telegram's own t.me/share URLs and tracking pixels
    if (url.includes('t.me/share') || url.includes('telegram.me/share')) continue;
    links.push(url);
  }
  return Array.from(new Set(links));
}

/** Decode minimal set of HTML entities found in Telegram post text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}

/** Convert a message ID string to a number for comparison. */
function numericId(id: string): number {
  return parseInt(id, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

