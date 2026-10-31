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
  // Public Telegram channel preview URL to poll for job posts.
  // Defaults to Freelance Ethiopia channel.
  TELEGRAM_CHANNEL_URL: z
    .string()
    .url()
    .default('https://t.me/s/freelance_ethio'),
  // How often to poll the channel, in milliseconds. Default: 15 minutes.
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
