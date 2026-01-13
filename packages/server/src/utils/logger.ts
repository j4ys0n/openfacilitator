/**
 * Structured logging utility for the OpenFacilitator server
 * Provides consistent log formatting with timestamps and context
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  facilitatorId?: string;
  facilitatorName?: string;
  network?: string;
  txHash?: string;
  payer?: string;
  amount?: string;
  asset?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  context?: LogContext;
  error?: string;
  stack?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get minimum log level from environment (default: info)
const MIN_LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function formatLog(entry: LogEntry): string {
  const { timestamp, level, category, message, context, error, stack } = entry;

  // Format: [TIMESTAMP] LEVEL [CATEGORY] Message | context
  const levelColors: Record<LogLevel, string> = {
    debug: '\x1b[90m', // gray
    info: '\x1b[36m',  // cyan
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';
  const color = levelColors[level];

  let output = `${color}[${timestamp}]${reset} ${color}${level.toUpperCase().padEnd(5)}${reset} [${category}] ${message}`;

  if (context && Object.keys(context).length > 0) {
    const contextStr = Object.entries(context)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    output += ` | ${contextStr}`;
  }

  if (error) {
    output += `\n  Error: ${error}`;
  }

  if (stack) {
    output += `\n  Stack: ${stack}`;
  }

  return output;
}

function log(level: LogLevel, category: string, message: string, context?: LogContext, err?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    context,
    error: err?.message,
    stack: level === 'error' && err?.stack ? err.stack : undefined,
  };

  const formatted = formatLog(entry);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Logger factory - creates a logger for a specific category
 */
export function createLogger(category: string) {
  return {
    debug: (message: string, context?: LogContext) => log('debug', category, message, context),
    info: (message: string, context?: LogContext) => log('info', category, message, context),
    warn: (message: string, context?: LogContext) => log('warn', category, message, context),
    error: (message: string, context?: LogContext, err?: Error) => log('error', category, message, context, err),
  };
}

// Pre-configured loggers for common categories
export const logger = {
  verify: createLogger('Verify'),
  settle: createLogger('Settle'),
  wallet: createLogger('Wallet'),
  tx: createLogger('Transaction'),
  auth: createLogger('Auth'),
  webhook: createLogger('Webhook'),
  server: createLogger('Server'),
  balance: createLogger('Balance'),
};

export default logger;
