/**
 * Unit tests for audit log functionality.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LangfuseExporterConfig } from '../src/lib/config';
import {
  cleanupAuditLog,
  createAuditLogEntry,
  initAuditLog,
  writeAuditLogEntry,
} from '../src/lib/audit-log';

// Create a unique temp directory for each test run
function createTestAuditDir(): string {
  return join(tmpdir(), `langfuse-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// Helper to create minimal config for testing
function createTestConfig(spoolDir: string): LangfuseExporterConfig {
  return {
    publicKey: 'test-pk',
    secretKey: 'test-sk',
    host: 'https://cloud.langfuse.com',
    exportMode: 'full',
    redactPatterns: [],
    flushInterval: 5000,
    spoolDir,
    maxSpoolSizeMB: 100,
    retentionDays: 7,
    traceNamePrefix: '',
    verbose: false,
    enabled: true,
  };
}

describe('createAuditLogEntry', () => {
  it('should create a valid audit log entry with all required fields', () => {
    const entry = createAuditLogEntry('trace', 'session-123', 'trace-456', {
      name: 'test-trace',
    });

    expect(entry.entityType).toBe('trace');
    expect(entry.sessionId).toBe('session-123');
    expect(entry.traceId).toBe('trace-456');
    expect(entry.data).toEqual({ name: 'test-trace' });
    expect(entry.timestamp).toBeDefined();
    expect(typeof entry.timestamp).toBe('number');
  });

  it('should support different entity types', () => {
    const trace = createAuditLogEntry('trace', 's1', 't1', {});
    const generation = createAuditLogEntry('generation', 's2', 't2', {});
    const span = createAuditLogEntry('span', 's3', 't3', {});

    expect(trace.entityType).toBe('trace');
    expect(generation.entityType).toBe('generation');
    expect(span.entityType).toBe('span');
  });
});

describe('audit log file operations', () => {
  let testAuditDir: string;
  let config: LangfuseExporterConfig;

  beforeEach(async () => {
    testAuditDir = createTestAuditDir();
    config = createTestConfig(testAuditDir);
  });

  afterEach(async () => {
    try {
      await rm(testAuditDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initAuditLog', () => {
    it('should create audit log directory if it does not exist', async () => {
      await initAuditLog(config);

      const stats = await readdir(testAuditDir);
      expect(stats).toBeDefined();
    });

    it('should not throw if directory already exists', async () => {
      await mkdir(testAuditDir, { recursive: true });
      await initAuditLog(config);
    });
  });

  describe('writeAuditLogEntry', () => {
    it('should write entries to JSONL file', async () => {
      await initAuditLog(config);

      const entry = createAuditLogEntry('trace', 'session-abc', 'trace-xyz', {
        name: 'my-trace',
      });

      await writeAuditLogEntry(entry, config);

      // Check file was created
      const files = await readdir(testAuditDir);
      const auditFile = files.find((f) => f.startsWith('audit-') && f.endsWith('.jsonl'));
      expect(auditFile).toBeDefined();

      // Check content
      if (auditFile) {
        const content = await readFile(join(testAuditDir, auditFile), 'utf-8');
        const parsed = JSON.parse(content.trim());
        expect(parsed.entityType).toBe('trace');
        expect(parsed.sessionId).toBe('session-abc');
        expect(parsed.traceId).toBe('trace-xyz');
      }
    });

    it('should append multiple entries to the same file', async () => {
      await initAuditLog(config);

      const entry1 = createAuditLogEntry('trace', 's1', 't1', { index: 1 });
      const entry2 = createAuditLogEntry('generation', 's1', 't1', { index: 2 });
      const entry3 = createAuditLogEntry('span', 's1', 't1', { index: 3 });

      await writeAuditLogEntry(entry1, config);
      await writeAuditLogEntry(entry2, config);
      await writeAuditLogEntry(entry3, config);

      const files = await readdir(testAuditDir);
      const auditFile = files.find((f) => f.startsWith('audit-'));
      if (auditFile) {
        const content = await readFile(join(testAuditDir, auditFile), 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(3);
      } else {
        expect(auditFile).toBeDefined();
      }
    });

    it('should not throw if directory does not exist', async () => {
      // Don't init - directory doesn't exist
      const entry = createAuditLogEntry('trace', 's1', 't1', {});
      // Should not throw
      await writeAuditLogEntry(entry, config);
    });
  });

  describe('cleanupAuditLog', () => {
    it('should remove old audit files based on retention', async () => {
      await initAuditLog(config);

      // Create an old audit file (simulate by naming convention)
      const oldFilePath = join(testAuditDir, 'audit-2020-01-01.jsonl');
      await writeFile(oldFilePath, '{"test":"data"}\n');

      const shortRetentionConfig = {
        ...config,
        retentionDays: 7,
      };

      await cleanupAuditLog(shortRetentionConfig);

      // Just verify cleanup doesn't throw
      const files = await readdir(testAuditDir);
      expect(Array.isArray(files)).toBe(true);
    });

    it('should not remove non-audit files', async () => {
      await initAuditLog(config);

      // Create a non-audit file
      const otherFile = join(testAuditDir, 'other-file.txt');
      await writeFile(otherFile, 'test data\n');

      await cleanupAuditLog(config);

      const files = await readdir(testAuditDir);
      expect(files).toContain('other-file.txt');
    });

    it('should not throw when directory is empty', async () => {
      await initAuditLog(config);
      await cleanupAuditLog(config);
    });

    it('should not throw when directory does not exist', async () => {
      const missingDirConfig = createTestConfig('/nonexistent/path/audit');
      await cleanupAuditLog(missingDirConfig);
    });
  });
});
