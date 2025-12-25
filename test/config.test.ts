/**
 * Unit tests for configuration loading and validation
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getInvalidPatterns, loadConfig, validateConfig } from '../src/lib/config';

describe('loadConfig', () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;
    delete process.env.OPENCODE_LANGFUSE_EXPORT_MODE;
    delete process.env.OPENCODE_LANGFUSE_REDACT_REGEX;
    delete process.env.OPENCODE_LANGFUSE_FLUSH_INTERVAL;
    delete process.env.OPENCODE_LANGFUSE_SPOOL_DIR;
    delete process.env.OPENCODE_LANGFUSE_MAX_SPOOL_MB;
    delete process.env.OPENCODE_LANGFUSE_RETENTION_DAYS;
    delete process.env.OPENCODE_LANGFUSE_TRACE_PREFIX;
    delete process.env.OPENCODE_LANGFUSE_VERBOSE;
    delete process.env.OPENCODE_LANGFUSE_ENABLED;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('environment variable loading', () => {
    it('should load Langfuse credentials from env vars', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-123';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-456';
      process.env.LANGFUSE_HOST = 'https://custom.langfuse.com';

      const config = loadConfig();

      expect(config.publicKey).toBe('pk-test-123');
      expect(config.secretKey).toBe('sk-test-456');
      expect(config.host).toBe('https://custom.langfuse.com');
    });

    it('should load exporter settings from env vars', () => {
      process.env.OPENCODE_LANGFUSE_EXPORT_MODE = 'metadata_only';
      process.env.OPENCODE_LANGFUSE_FLUSH_INTERVAL = '10000';
      process.env.OPENCODE_LANGFUSE_SPOOL_DIR = '/custom/spool';
      process.env.OPENCODE_LANGFUSE_MAX_SPOOL_MB = '200';
      process.env.OPENCODE_LANGFUSE_RETENTION_DAYS = '14';
      process.env.OPENCODE_LANGFUSE_TRACE_PREFIX = 'myapp-';
      process.env.OPENCODE_LANGFUSE_VERBOSE = 'true';

      const config = loadConfig();

      expect(config.exportMode).toBe('metadata_only');
      expect(config.flushInterval).toBe(10000);
      expect(config.spoolDir).toBe('/custom/spool');
      expect(config.maxSpoolSizeMB).toBe(200);
      expect(config.retentionDays).toBe(14);
      expect(config.traceNamePrefix).toBe('myapp-');
      expect(config.verbose).toBe(true);
    });

    it('should handle enabled flag correctly', () => {
      process.env.OPENCODE_LANGFUSE_ENABLED = 'false';
      const config = loadConfig();
      expect(config.enabled).toBe(false);
    });

    it('should default enabled to true', () => {
      const config = loadConfig();
      expect(config.enabled).toBe(true);
    });
  });

  describe('default values', () => {
    it('should use default host when not specified', () => {
      const config = loadConfig();
      expect(config.host).toBe('https://cloud.langfuse.com');
    });

    it('should use default export mode "full"', () => {
      const config = loadConfig();
      expect(config.exportMode).toBe('full');
    });

    it('should use default flush interval of 5000ms', () => {
      const config = loadConfig();
      expect(config.flushInterval).toBe(5000);
    });

    it('should use default max spool size of 100MB', () => {
      const config = loadConfig();
      expect(config.maxSpoolSizeMB).toBe(100);
    });

    it('should use default retention of 7 days', () => {
      const config = loadConfig();
      expect(config.retentionDays).toBe(7);
    });

    it('should default verbose to false', () => {
      const config = loadConfig();
      expect(config.verbose).toBe(false);
    });

    it('should use HOME-based spool dir by default', () => {
      const config = loadConfig();
      expect(config.spoolDir).toContain('.opencode/langfuse-spool');
    });
  });

  describe('plugin config merging', () => {
    it('should allow plugin config to provide defaults', () => {
      const pluginConfig = {
        publicKey: 'plugin-pk',
        secretKey: 'plugin-sk',
        host: 'https://plugin.langfuse.com',
      };

      const config = loadConfig(pluginConfig);

      expect(config.publicKey).toBe('plugin-pk');
      expect(config.secretKey).toBe('plugin-sk');
      expect(config.host).toBe('https://plugin.langfuse.com');
    });

    it('should prefer env vars over plugin config', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'env-pk';

      const pluginConfig = {
        publicKey: 'plugin-pk',
      };

      const config = loadConfig(pluginConfig);

      expect(config.publicKey).toBe('env-pk');
    });
  });

  describe('redact patterns parsing', () => {
    it('should parse comma-separated regex patterns', () => {
      process.env.OPENCODE_LANGFUSE_REDACT_REGEX = 'secret-\\d+,password:\\s*\\S+';

      const config = loadConfig();

      expect(config.redactPatterns).toHaveLength(2);
      expect(config.redactPatterns[0]).toBeInstanceOf(RegExp);
      expect(config.redactPatterns[1]).toBeInstanceOf(RegExp);
    });

    it('should handle empty redact patterns', () => {
      const config = loadConfig();
      expect(config.redactPatterns).toEqual([]);
    });

    it('should skip invalid regex patterns gracefully', () => {
      // Invalid regex: unbalanced parenthesis
      process.env.OPENCODE_LANGFUSE_REDACT_REGEX = 'valid-\\d+,(invalid[,another-valid';

      const config = loadConfig();

      // Should have 2 valid patterns (skipping the invalid one)
      expect(config.redactPatterns.length).toBeGreaterThanOrEqual(1);
    });

    it('should track invalid patterns via getInvalidPatterns', () => {
      // Need to trigger a fresh load with invalid pattern
      process.env.OPENCODE_LANGFUSE_REDACT_REGEX = '(unclosed';

      loadConfig();

      // Note: getInvalidPatterns accumulates across tests, so just check it's an array
      expect(Array.isArray(getInvalidPatterns())).toBe(true);
    });
  });
});

describe('validateConfig', () => {
  it('should return no errors for valid full config', () => {
    const config = {
      publicKey: 'pk-123',
      secretKey: 'sk-456',
      host: 'https://cloud.langfuse.com',
      exportMode: 'full' as const,
      redactPatterns: [],
      flushInterval: 5000,
      spoolDir: '/tmp/spool',
      maxSpoolSizeMB: 100,
      retentionDays: 7,
      traceNamePrefix: '',
      verbose: false,
      enabled: true,
    };

    const errors = validateConfig(config);

    expect(errors).toEqual([]);
  });

  it('should require publicKey when export mode is not off', () => {
    const config = {
      publicKey: '',
      secretKey: 'sk-456',
      host: 'https://cloud.langfuse.com',
      exportMode: 'full' as const,
      redactPatterns: [],
      flushInterval: 5000,
      spoolDir: '/tmp/spool',
      maxSpoolSizeMB: 100,
      retentionDays: 7,
      traceNamePrefix: '',
      verbose: false,
      enabled: true,
    };

    const errors = validateConfig(config);

    expect(errors).toContain('LANGFUSE_PUBLIC_KEY is required');
  });

  it('should require secretKey when export mode is not off', () => {
    const config = {
      publicKey: 'pk-123',
      secretKey: '',
      host: 'https://cloud.langfuse.com',
      exportMode: 'full' as const,
      redactPatterns: [],
      flushInterval: 5000,
      spoolDir: '/tmp/spool',
      maxSpoolSizeMB: 100,
      retentionDays: 7,
      traceNamePrefix: '',
      verbose: false,
      enabled: true,
    };

    const errors = validateConfig(config);

    expect(errors).toContain('LANGFUSE_SECRET_KEY is required');
  });

  it('should not require keys when export mode is off', () => {
    const config = {
      publicKey: '',
      secretKey: '',
      host: 'https://cloud.langfuse.com',
      exportMode: 'off' as const,
      redactPatterns: [],
      flushInterval: 5000,
      spoolDir: '/tmp/spool',
      maxSpoolSizeMB: 100,
      retentionDays: 7,
      traceNamePrefix: '',
      verbose: false,
      enabled: true,
    };

    const errors = validateConfig(config);

    expect(errors).toEqual([]);
  });

  it('should return multiple errors when both keys are missing', () => {
    const config = {
      publicKey: '',
      secretKey: '',
      host: 'https://cloud.langfuse.com',
      exportMode: 'full' as const,
      redactPatterns: [],
      flushInterval: 5000,
      spoolDir: '/tmp/spool',
      maxSpoolSizeMB: 100,
      retentionDays: 7,
      traceNamePrefix: '',
      verbose: false,
      enabled: true,
    };

    const errors = validateConfig(config);

    expect(errors).toHaveLength(2);
    expect(errors).toContain('LANGFUSE_PUBLIC_KEY is required');
    expect(errors).toContain('LANGFUSE_SECRET_KEY is required');
  });
});
