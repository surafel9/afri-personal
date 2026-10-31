import { z } from "zod";

// Automatically load .env file if available (Node >= 20.6)
try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile();
  }
} catch {
  // If .env file does not exist, ignore and rely on environment variables
}

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  OWNER_CHAT_ID: z
    .string()
    .min(1, "OWNER_CHAT_ID is required")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int("OWNER_CHAT_ID must be an integer")),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  DB_PATH: z.string().default("data/afripersonal.db"),
  NOTIFICATION_THRESHOLD: z
    .string()
    .default("60")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(0).max(100)),
  DATA_RETENTION_DAYS: z
    .string()
    .default("90")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1)),
  // ── Channel polling ────────────────────────────────────────────────────────
  // Public Telegram channel preview URL to poll for job posts (legacy single-channel fallback)
  TELEGRAM_CHANNEL_URL: z
    .string()
    .url()
    .default('https://t.me/s/freelance_ethio'),
  // Comma-separated list of Telegram channel handles or URLs
  // Defaults to all 4 supported Ethiopian tech/freelance job channels.
  TELEGRAM_CHANNELS: z
    .string()
    .default('freelance_ethio,DagmawiBabiJobs,ethiojobsofficial,qena_jobs'),
  // How often to poll the channels, in milliseconds. Default: 15 minutes.
  POLLING_INTERVAL_MS: z
    .string()
    .default("900000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(60000)),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(
      `[AfriPersonal] Configuration error — check your .env file:\n${formatted}`
    );
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export type Config = typeof config;

export interface ChannelInfo {
  handle: string; // e.g. "freelance_ethio"
  name: string; // e.g. "@freelance_ethio"
  webUrl: string; // e.g. "https://t.me/s/freelance_ethio"
  publicUrl: string; // e.g. "https://t.me/freelance_ethio"
  sourceId: string; // e.g. "telegram-web:freelance_ethio"
  displayName: string; // e.g. "Freelance Ethiopia (@freelance_ethio)"
}

export function parseChannelHandle(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/t\.me\/(s\/)?/, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .trim();
}

const KNOWN_CHANNEL_NAMES: Record<string, string> = {
  freelance_ethio: 'Freelance Ethiopia',
  DagmawiBabiJobs: 'Dagmawi Babi Tech Jobs',
  ethiojobsofficial: 'Ethio Jobs Official',
  qena_jobs: 'Qena Jobs',
};

export function getMonitoredChannels(): ChannelInfo[] {
  const rawList = config.TELEGRAM_CHANNELS
    ? config.TELEGRAM_CHANNELS.split(',')
    : [config.TELEGRAM_CHANNEL_URL];

  const seen = new Set<string>();
  const list: ChannelInfo[] = [];

  for (const item of rawList) {
    const handle = parseChannelHandle(item);
    if (!handle || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());

    const friendlyName = KNOWN_CHANNEL_NAMES[handle] ?? handle;
    list.push({
      handle,
      name: `@${handle}`,
      webUrl: `https://t.me/s/${handle}`,
      publicUrl: `https://t.me/${handle}`,
      sourceId: `telegram-web:${handle}`,
      displayName: `${friendlyName} (@${handle})`,
    });
  }

  return list;
}
