export interface RawMessage {
  sourceId: string; // e.g. "manual", "fixture"
  externalId: string; // unique within the source
  postedAt: Date | null; // when the original was posted
  fetchedAt: Date; // when we received it
  text: string;
  links: string[];
  hasMedia: boolean;
}

export interface SourceAdapter {
  readonly sourceId: string;
  readonly displayName: string;
  fetchNew(): AsyncIterable<RawMessage>;
}
