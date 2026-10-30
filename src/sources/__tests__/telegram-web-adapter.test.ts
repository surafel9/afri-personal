/**
 * telegram-web-adapter.test.ts
 * Unit tests for the TelegramWebAdapter HTML parser.
 * No real network calls — uses mock HTML fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePosts } from '../telegram-web-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'telegram-web-sample.html');

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8');
}

describe('parsePosts', () => {
  it('parses all posts with text content from fixture HTML', () => {
    const html = loadFixture();
    const posts = parsePosts(html);

    // Fixture has 5 message blocks; message 1004 has no text → should be skipped
    expect(posts).toHaveLength(4);
  });

  it('extracts message IDs correctly', () => {
    const html = loadFixture();
    const posts = parsePosts(html);
    const ids = posts.map((p) => p.messageId);

    expect(ids).toContain('1001');
    expect(ids).toContain('1002');
    expect(ids).toContain('1003');
    expect(ids).toContain('1005');
    // 1004 has no text, should be excluded
    expect(ids).not.toContain('1004');
  });

  it('extracts post timestamps as Date objects', () => {
    const html = loadFixture();
    const posts = parsePosts(html);
    const post1001 = posts.find((p) => p.messageId === '1001');

    expect(post1001).toBeDefined();
    expect(post1001!.postedAt).toBeInstanceOf(Date);
    expect(post1001!.postedAt!.toISOString()).toBe('2026-10-28T05:00:00.000Z');
  });

  it('extracts links from post content', () => {
    const html = loadFixture();
    const posts = parsePosts(html);
    const post1003 = posts.find((p) => p.messageId === '1003');

    expect(post1003).toBeDefined();
    expect(post1003!.links).toContain('https://forms.gle/exampleFormLink');
  });

  it('does not include t.me/share links in extracted links', () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message" data-post="ch/100">
          <div class="tgme_widget_message_text">
            Apply here: <a href="https://t.me/share/url?url=https://example.com">share</a>
            Real link: <a href="https://example.com/apply">apply</a>
          </div>
          <time datetime="2026-01-01T00:00:00Z"></time>
        </div>
      </div>
    `;
    const posts = parsePosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.links).not.toContain(expect.stringContaining('t.me/share'));
    expect(posts[0]!.links).toContain('https://example.com/apply');
  });

  it('strips HTML tags from post text', () => {
    const html = loadFixture();
    const posts = parsePosts(html);
    const post1001 = posts.find((p) => p.messageId === '1001');

    expect(post1001!.text).not.toMatch(/<[^>]+>/);
    expect(post1001!.text).toContain('We are Hiring');
    expect(post1001!.text).toContain('Node.js and React');
  });

  it('decodes HTML entities in post text', () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message" data-post="ch/200">
          <div class="tgme_widget_message_text">
            Company &amp; Co is hiring a developer &lt;senior&gt; &mdash; salary &gt; 50k
          </div>
          <time datetime="2026-01-01T00:00:00Z"></time>
        </div>
      </div>
    `;
    const posts = parsePosts(html);
    expect(posts[0]!.text).toContain('Company & Co');
    expect(posts[0]!.text).toContain('<senior>');
    expect(posts[0]!.text).toContain('> 50k');
  });

  it('returns empty array for empty HTML', () => {
    expect(parsePosts('')).toHaveLength(0);
    expect(parsePosts('<html><body></body></html>')).toHaveLength(0);
  });

  it('handles malformed blocks gracefully without throwing', () => {
    const malformed = `
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message" data-post="ch/999">
          <!-- no tgme_widget_message_text div here -->
          <time datetime="2026-01-01T00:00:00Z"></time>
        </div>
      </div>
    `;
    expect(() => parsePosts(malformed)).not.toThrow();
    expect(parsePosts(malformed)).toHaveLength(0);
  });

  it('returns null timestamp when datetime attribute is missing', () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message" data-post="ch/300">
          <div class="tgme_widget_message_text">Some job post text here with enough content</div>
        </div>
      </div>
    `;
    const posts = parsePosts(html);
    expect(posts[0]!.postedAt).toBeNull();
  });

  it('deduplicates identical links within a single post', () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message" data-post="ch/400">
          <div class="tgme_widget_message_text">
            <a href="https://example.com/apply">Apply</a>
            <a href="https://example.com/apply">Apply again</a>
          </div>
          <time datetime="2026-01-01T00:00:00Z"></time>
        </div>
      </div>
    `;
    const posts = parsePosts(html);
    expect(posts[0]!.links.filter((l) => l === 'https://example.com/apply')).toHaveLength(1);
  });
});

describe('parsePosts — incremental filtering (simulated)', () => {
  it('correctly identifies post IDs by numeric value', () => {
    const html = loadFixture();
    const posts = parsePosts(html);

    // Sort ascending by messageId (as TelegramWebAdapter does internally)
    const sorted = posts.sort((a, b) => parseInt(a.messageId, 10) - parseInt(b.messageId, 10));
    expect(sorted[0]!.messageId).toBe('1001');
    expect(sorted[sorted.length - 1]!.messageId).toBe('1005');
  });
});

