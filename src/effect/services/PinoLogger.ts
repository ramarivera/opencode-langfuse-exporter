/**
 * PinoLogger - Effect Logger that delegates to Pino.
 *
 * This allows using Effect.log(), Effect.logDebug(), etc. throughout
 * the codebase while getting Pino's structured JSON logging to file.
 *
 * Uses Effect's resource management for proper cleanup on shutdown.
 */

import { Effect, Layer, Logger, LogLevel, Scope } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { LOG_DIR, LOG_FILE } from '../constants.js';

/**
 * Expand ~ to home directory.
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Ensure log directory exists.
 */
function ensureLogDir(logDir: string): void {
  const expanded = expandPath(logDir);
  if (!fs.existsSync(expanded)) {
    fs.mkdirSync(expanded, { recursive: true });
  }
}

/**
 * Map Effect LogLevel to Pino level string.
 */
function toPinoLevel(level: LogLevel.LogLevel): string {
  switch (level._tag) {
    case 'Fatal':
      return 'fatal';
    case 'Error':
      return 'error';
    case 'Warning':
      return 'warn';
    case 'Info':
      return 'info';
    case 'Debug':
      return 'debug';
    case 'Trace':
      return 'trace';
    default:
      return 'info';
  }
}

/**
 * File logger interface.
 */
interface FileLogger {
  readonly log: (level: string, message: string, context?: Record<string, unknown>) => void;
  readonly close: () => void;
}

/**
 * Create a file logger as a scoped resource.
 * The stream is automatically closed when the scope is closed.
 *
 * This follows the Effect best practice of using acquireRelease
 * for resources that need cleanup.
 */
const acquireFileLogger = (logPath: string): Effect.Effect<FileLogger, never, Scope.Scope> =>
  Effect.acquireRelease(
    // Acquire: create the file stream
    Effect.sync(() => {
      const expanded = expandPath(logPath);
      const stream = fs.createWriteStream(expanded, { flags: 'a' });

      return {
        log: (level: string, message: string, context?: Record<string, unknown>) => {
          const entry = {
            level,
            time: Date.now(),
            msg: message,
            ...context,
          };
          stream.write(`${JSON.stringify(entry)}\n`);
        },
        close: () => {
          stream.end();
        },
      };
    }),
    // Release: close the stream
    (fileLogger) => Effect.sync(() => fileLogger.close())
  );

/**
 * Create the Pino-backed Effect Logger with proper resource management.
 *
 * The file logger is acquired as a scoped resource, ensuring it gets
 * cleaned up when the layer is disposed.
 */
const createPinoLoggerScoped = Effect.gen(function* () {
  ensureLogDir(LOG_DIR);
  const logPath = path.join(expandPath(LOG_DIR), LOG_FILE);
  const fileLogger = yield* acquireFileLogger(logPath);

  return Logger.make<unknown, void>(({ logLevel, message, annotations, date, fiberId }) => {
    const level = toPinoLevel(logLevel);
    const msg = typeof message === 'string' ? message : JSON.stringify(message);

    // Convert annotations to plain object
    const context: Record<string, unknown> = {
      fiberId: String(fiberId),
      timestamp: date.toISOString(),
    };

    // Add annotations if any
    for (const [key, value] of annotations) {
      context[key] = value;
    }

    fileLogger.log(level, msg, context);
  });
});

/**
 * Live layer that replaces the default Effect Logger with our file-only Pino logger.
 *
 * Uses Layer.scoped to properly manage the file stream lifecycle:
 * - Stream is opened when the layer is built
 * - Stream is closed when the layer/runtime is disposed
 *
 * This ensures nothing ever leaks to console and file handles are properly cleaned up.
 */
export const PinoLoggerLive = Layer.unwrapScoped(
  createPinoLoggerScoped.pipe(
    Effect.map((pinoLogger) =>
      Layer.mergeAll(
        // Kill the default console logger
        Logger.replace(Logger.defaultLogger, Logger.none),
        // Add our file-only logger
        Logger.add(pinoLogger)
      )
    )
  )
);

/**
 * Console logger for development/testing.
 */
export const ConsoleLoggerLive = Logger.replace(
  Logger.defaultLogger,
  Logger.make(({ logLevel, message }) => {
    const level = toPinoLevel(logLevel);
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    const prefix = `[langfuse-exporter] [${level.toUpperCase()}]`;

    // Use appropriate console method based on level
    switch (level) {
      case 'error':
      case 'fatal':
        // eslint-disable-next-line no-console
        console.error(`${prefix} ${msg}`);
        break;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(`${prefix} ${msg}`);
        break;
      case 'debug':
      case 'trace':
        // eslint-disable-next-line no-console
        console.debug(`${prefix} ${msg}`);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(`${prefix} ${msg}`);
    }
  })
);
