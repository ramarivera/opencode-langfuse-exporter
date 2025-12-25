/**
 * Disk-based spool for reliable event buffering.
 *
 * Features:
 * - JSONL file format for append-only writes
 * - Automatic cleanup based on age and size limits
 * - Idempotency key tracking to prevent duplicates
 * - Graceful recovery after crashes
 * - Never throws uncaught exceptions
 */

import { appendFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { LangfuseExporterConfig } from './config';
import { logDebug, logError, logInfo } from './logger';

// SpooledEventData needs to be flexible to store trace/generation/span data

export type SpooledEventData = Record<string, unknown>;

export interface SpooledEvent {
  id: string;
  idempotencyKey: string;
  timestamp: number;
  type: 'trace' | 'generation' | 'span';
  sessionId: string;
  data: SpooledEventData;
  retryCount: number;
}

interface SpoolState {
  processedKeys: Set<string>;
  pendingEvents: SpooledEvent[];
}

/**
 * Get the current spool filename (one file per day)
 */
function getSpoolFilename(): string {
  const date = new Date().toISOString().split('T')[0];
  return `spool-${date}.jsonl`;
}

/**
 * Initialize the spool directory
 */
export async function initSpool(config: LangfuseExporterConfig): Promise<void> {
  try {
    await mkdir(config.spoolDir, { recursive: true });
    logDebug('Spool directory initialized', { path: config.spoolDir });
  } catch (error) {
    logError(error, 'Failed to create spool directory');
    // Don't throw - we'll try again on write
  }
}

/**
 * Write an event to the spool file
 */
export async function writeToSpool(
  event: SpooledEvent,
  config: LangfuseExporterConfig
): Promise<void> {
  const filename = join(config.spoolDir, getSpoolFilename());
  const line = `${JSON.stringify(event)}\n`;

  try {
    await appendFile(filename, line, 'utf-8');
    logDebug('Event written to spool', { file: filename, type: event.type });
  } catch (error) {
    logError(error, 'Failed to write to spool');
    // Don't throw - event is lost but we don't break the plugin
  }
}

/**
 * Mark an event as processed by writing a processed marker
 */
export async function markProcessed(
  idempotencyKey: string,
  config: LangfuseExporterConfig
): Promise<void> {
  const filename = join(config.spoolDir, 'processed.jsonl');
  const line = `${JSON.stringify({ key: idempotencyKey, timestamp: Date.now() })}\n`;

  try {
    await appendFile(filename, line, 'utf-8');
  } catch (error) {
    logError(error, 'Failed to mark event as processed');
    // Don't throw - worst case we'll reprocess the event
  }
}

/**
 * Load processed keys from disk
 */
async function loadProcessedKeys(config: LangfuseExporterConfig): Promise<Set<string>> {
  const filename = join(config.spoolDir, 'processed.jsonl');
  const keys = new Set<string>();

  try {
    const content = await readFile(filename, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        keys.add(data.key);
      } catch {
        // Skip invalid lines - don't log to avoid noise
      }
    }
  } catch {
    // File doesn't exist yet, that's fine - no need to log
  }

  return keys;
}

/**
 * Load pending events from spool files
 */
export async function loadPendingEvents(config: LangfuseExporterConfig): Promise<SpoolState> {
  const processedKeys = await loadProcessedKeys(config);
  const pendingEvents: SpooledEvent[] = [];

  try {
    const files = await readdir(config.spoolDir);
    const spoolFiles = files.filter((f) => f.startsWith('spool-') && f.endsWith('.jsonl'));

    for (const file of spoolFiles) {
      const filepath = join(config.spoolDir, file);

      try {
        const content = await readFile(filepath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as SpooledEvent;
            // Skip already processed events
            if (!processedKeys.has(event.idempotencyKey)) {
              pendingEvents.push(event);
            }
          } catch {
            // Skip invalid lines - don't log to avoid noise
          }
        }
      } catch (error) {
        logError(error, `Failed to read spool file ${file}`);
        // Continue with other files
      }
    }
  } catch {
    // Directory doesn't exist yet, that's fine
  }

  return { processedKeys, pendingEvents };
}

/**
 * Clean up old spool files based on retention policy and size limits
 */
export async function cleanupSpool(config: LangfuseExporterConfig): Promise<void> {
  try {
    const files = await readdir(config.spoolDir);
    const now = Date.now();
    const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
    const maxSizeBytes = config.maxSpoolSizeMB * 1024 * 1024;

    // Get file stats and sort by age
    const fileStats: Array<{ name: string; path: string; mtime: number; size: number }> = [];

    for (const file of files) {
      const filepath = join(config.spoolDir, file);
      try {
        const stats = await stat(filepath);
        fileStats.push({
          name: file,
          path: filepath,
          mtime: stats.mtimeMs,
          size: stats.size,
        });
      } catch {
        // File may have been deleted - continue
      }
    }

    // Sort by modification time (oldest first)
    fileStats.sort((a, b) => a.mtime - b.mtime);

    // Calculate total size
    let totalSize = fileStats.reduce((sum, f) => sum + f.size, 0);

    for (const file of fileStats) {
      const age = now - file.mtime;
      const shouldDeleteByAge = age > retentionMs;
      const shouldDeleteBySize = totalSize > maxSizeBytes;

      if (shouldDeleteByAge || shouldDeleteBySize) {
        try {
          await unlink(file.path);
          totalSize -= file.size;
          logInfo('Cleaned up old spool file', { file: file.name });
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  } catch {
    // Ignore errors during cleanup - not critical
  }
}

/**
 * Create a SpooledEvent from trace data
 */
export function createSpooledEvent(
  type: 'trace' | 'generation' | 'span',
  sessionId: string,
  idempotencyKey: string,
  data: SpooledEventData
): SpooledEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    idempotencyKey,
    timestamp: Date.now(),
    type,
    sessionId,
    data,
    retryCount: 0,
  };
}
