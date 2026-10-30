import pino from 'pino';

// Tokens and secrets that must never appear in logs
const REDACTED_KEYS = [
  'BOT_TOKEN',
  'botToken',
  'token',
  'password',
  'secret',
  'authorization',
];

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: REDACTED_KEYS,
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export { logger };
export default logger;
