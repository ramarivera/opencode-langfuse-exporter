/**
 * Pino-based logging for the Langfuse exporter plugin.
 *
 * Logs are written to {opencode data dir}/.opencode/langfuse-exporter/logs/
 * with daily rotation and configurable verbosity.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

// ============================================================
// LOG DIRECTORY SETUP
// ============================================================

/**
 * Base directory for plugin data (relative to cwd where OpenCode runs).
 * Uses .opencode/langfuse-exporter to avoid polluting the project root.
 */
const PLUGIN_BASE_DIR = '.opencode/langfuse-exporter';

/**
 * Get the log directory for this plugin (relative path).
 */
function getLogDir(): string {
  return join(PLUGIN_BASE_DIR, 'logs');
}

/**
 * Ensure the log directory exists
 */
function ensureLogDir(logDir: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // Directory may already exist or we can't create it
    // In either case, pino will handle the error gracefully
  }
}

/**
 * Get current log filename (daily rotation)
 */
function getLogFilename(): string {
  const date = new Date().toISOString().split('T')[0];
  return `langfuse-exporter-${date}.log`;
}

// ============================================================
// LOGGER INSTANCE
// ============================================================

const logDir = getLogDir();
ensureLogDir(logDir);

const logFilePath = join(logDir, getLogFilename());

/**
 * The main logger instance for the plugin.
 * Uses pino.destination for reliable async file writing.
 */
export const logger = pino(
  {
    name: 'langfuse-exporter',
    level: 'debug', // Default to debug for now
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({
    dest: logFilePath,
    sync: false, // Async writes for better performance
  })
);

/**
 * Set the log level dynamically
 */
export function setLogLevel(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'): void {
  logger.level = level;
}

/**
 * Enable verbose (debug) logging
 */
export function enableVerbose(): void {
  setLogLevel('debug');
}

/**
 * Get the log file path for debugging/user reference
 */
export function getLogFilePath(): string {
  return logFilePath;
}

// ============================================================
// SAFE LOGGING HELPERS
// These helpers ensure we never throw from logging
// ============================================================

/**
 * Safely log an info message
 */
export function logInfo(message: string, context?: Record<string, unknown>): void {
  try {
    if (context) {
      logger.info(context, message);
    } else {
      logger.info(message);
    }
  } catch {
    // Never throw from logging
  }
}

/**
 * Safely log a debug message
 */
export function logDebug(message: string, context?: Record<string, unknown>): void {
  try {
    if (context) {
      logger.debug(context, message);
    } else {
      logger.debug(message);
    }
  } catch {
    // Never throw from logging
  }
}

/**
 * Safely log a warning
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  try {
    if (context) {
      logger.warn(context, message);
    } else {
      logger.warn(message);
    }
  } catch {
    // Never throw from logging
  }
}

/**
 * Safely log an error
 */
export function logError(error: Error | unknown, message: string): void {
  try {
    if (error instanceof Error) {
      logger.error({ err: error }, message);
    } else {
      logger.error({ err: String(error) }, message);
    }
  } catch {
    // Never throw from logging
  }
}

/**
 * Safely log a fatal error
 */
export function logFatal(error: Error | unknown, message: string): void {
  try {
    if (error instanceof Error) {
      logger.fatal({ err: error }, message);
    } else {
      logger.fatal({ err: String(error) }, message);
    }
  } catch {
    // Never throw from logging
  }
}
