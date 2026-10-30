import { z } from "zod";

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
