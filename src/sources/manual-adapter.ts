/**
 * manual-adapter.ts
 * Source adapter for user-forwarded messages or pasted text (/import).
 * 100% compliant with Telegram Terms of Service.
 */

import { createHash } from 'node:crypto';
import type { RawMessage, SourceAdapter } from './types.js';

export class ManualImportAdapter implements SourceAdapter {
  readonly sourceId = 'manual';
  readonly displayName = 'Manual / Forwarded Import';

  private queue: RawMessage[] = [];

  /**
   * Enqueue a raw message manually imported by the user.
   */
  enqueue(input: {
    text: string;
    externalId?: string;
    postedAt?: Date | null;
    links?: string[];
    hasMedia?: boolean;
  }): RawMessage {
    // Generate externalId from hash of text + timestamp if not provided
    const externalId =
      input.externalId ??
      createHash('sha256')
        .update(input.text + (input.postedAt?.toISOString() ?? ''))
        .digest('hex')
        .slice(0, 16);

    const message: RawMessage = {
      sourceId: this.sourceId,
      externalId,
      postedAt: input.postedAt ?? null,
      fetchedAt: new Date(),
      text: input.text,
      links: input.links ?? this.extractLinks(input.text),
      hasMedia: input.hasMedia ?? false,
    };

    this.queue.push(message);
    return message;
  }

  async *fetchNew(): AsyncIterable<RawMessage> {
    while (this.queue.length > 0) {
      const msg = this.queue.shift();
      if (msg) {
        yield msg;
      }
    }
  }

  private extractLinks(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s\])"']+/g);
    return matches ? Array.from(new Set(matches)) : [];
  }
}

