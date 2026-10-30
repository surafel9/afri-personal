import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RawMessage, SourceAdapter } from './types.js';

interface FixtureEntry {
  id: string;
  postedAt: string | null;
  text: string;
  links: string[];
  hasMedia: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FixtureAdapter implements SourceAdapter {
  readonly sourceId = 'fixture';
  readonly displayName = 'Fixture Loader (Test Data)';

  private readonly fixturesPath: string;

  constructor(fixturesPath?: string) {
    this.fixturesPath =
      fixturesPath ?? join(__dirname, 'fixtures', 'sample-messages.json');
  }

  async *fetchNew(): AsyncIterable<RawMessage> {
    const raw = await readFile(this.fixturesPath, 'utf-8');
    const entries: FixtureEntry[] = JSON.parse(raw) as FixtureEntry[];
    const fetchedAt = new Date();

    for (const entry of entries) {
      yield {
        sourceId: this.sourceId,
        externalId: entry.id,
        postedAt: entry.postedAt != null ? new Date(entry.postedAt) : null,
        fetchedAt,
        text: entry.text,
        links: entry.links,
        hasMedia: entry.hasMedia,
      };
    }
  }
}
