/**
 * Audit log for Langfuse events.
 *
 * An optional write-behind log that persists events to disk for:
 * - Debugging and troubleshooting
 * - Compliance and audit trails
 * - Offline analysis
 *
 * This is NOT used for retries - Effect handles that.
 * The audit log is fire-and-forget and never throws.
 */

import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { LangfuseExporterConfig } from './config';
import { logDebug, logError, logInfo } from './logger';

/**
 * Audit log entry for a Langfuse event.
 */
export interface AuditLogEntry {
  /** Timestamp when the event was logged */
  readonly timestamp: number;
  /** Type of Langfuse entity */
  readonly entityType: 'trace' | 'generation' | 'span';
  /** Session ID this event belongs to */
  readonly sessionId: string;
  /** Trace ID in Langfuse */
  readonly traceId: string;
  /** Event data (may be redacted based on config) */
  readonly data: Record<string, unknown>;
}

/**
 * Get the current audit log filename (one file per day).
 */
function getAuditLogFilename(): string {
  const date = new Date().toISOString().split('T')[0];
  return `audit-${date}.jsonl`;
}

/**
 * Initialize the audit log directory.
 * Creates the directory if it doesn't exist.
 */
export async function initAuditLog(config: LangfuseExporterConfig): Promise<void> {
  try {
    await mkdir(config.spoolDir, { recursive: true });
    logDebug('Audit log directory initialized', { path: config.spoolDir });
  } catch (error) {
    logError(error, 'Failed to create audit log directory');
    // Don't throw - we'll try again on write
  }
}

/**
 * Write an entry to the audit log.
 * This is fire-and-forget - errors are logged but not propagated.
 */
export async function writeAuditLogEntry(
  entry: AuditLogEntry,
  config: LangfuseExporterConfig
): Promise<void> {
  const filename = join(config.spoolDir, getAuditLogFilename());
  const line = `${JSON.stringify(entry)}\n`;

  try {
    await appendFile(filename, line, 'utf-8');
    logDebug('Audit log entry written', {
      file: filename,
      entityType: entry.entityType,
      sessionId: entry.sessionId,
    });
  } catch (error) {
    logError(error, 'Failed to write audit log entry');
    // Don't throw - audit logging should never break the plugin
  }
}

/**
 * Create an audit log entry from Langfuse entity data.
 */
export function createAuditLogEntry(
  entityType: 'trace' | 'generation' | 'span',
  sessionId: string,
  traceId: string,
  data: Record<string, unknown>
): AuditLogEntry {
  return {
    timestamp: Date.now(),
    entityType,
    sessionId,
    traceId,
    data,
  };
}

/**
 * Clean up old audit log files based on retention policy.
 */
export async function cleanupAuditLog(config: LangfuseExporterConfig): Promise<void> {
  try {
    const files = await readdir(config.spoolDir);
    const now = Date.now();
    const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
    const maxSizeBytes = config.maxSpoolSizeMB * 1024 * 1024;

    // Get file stats for audit files only
    const fileStats: Array<{ name: string; path: string; mtime: number; size: number }> = [];

    for (const file of files) {
      if (!file.startsWith('audit-') || !file.endsWith('.jsonl')) {
        continue;
      }

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
          logInfo('Cleaned up old audit log file', { file: file.name });
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  } catch {
    // Ignore errors during cleanup - not critical
  }
}
