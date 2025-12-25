/**
 * Unit tests for redaction utilities
 */
import { describe, expect, it } from 'vitest';

import type { LangfuseExporterConfig } from '../src/lib/config';
import { processContent, processObject, redactObject, redactText } from '../src/lib/redaction';

// Helper to create minimal config for testing
function createTestConfig(overrides: Partial<LangfuseExporterConfig> = {}): LangfuseExporterConfig {
  return {
    publicKey: 'test-pk',
    secretKey: 'test-sk',
    host: 'https://cloud.langfuse.com',
    exportMode: 'full',
    redactPatterns: [],
    flushInterval: 5000,
    spoolDir: '/tmp/test-spool',
    maxSpoolSizeMB: 100,
    retentionDays: 7,
    traceNamePrefix: '',
    verbose: false,
    enabled: true,
    ...overrides,
  };
}

describe('redactText', () => {
  describe('built-in patterns', () => {
    it('should redact generic API keys starting with sk_', () => {
      // Pattern expects: (sk|pk|api|key|token|secret|password|auth)[_-]?[a-zA-Z0-9]{20,}
      // So sk_abc123def456ghi789jkl012 works (sk_ + 24 chars)
      const text = 'My API key is sk_abc123def456ghi789jkl012mno';
      const result = redactText(text, []);
      expect(result).toBe('My API key is [REDACTED]');
    });

    it('should redact generic API keys starting with api_', () => {
      const text = 'Config: api_12345678901234567890abcd';
      const result = redactText(text, []);
      expect(result).toBe('Config: [REDACTED]');
    });

    it('should redact AWS access keys', () => {
      const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
      const result = redactText(text, []);
      expect(result).toBe('AWS key: [REDACTED]');
    });

    it('should redact JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const text = `Token: ${jwt}`;
      const result = redactText(text, []);
      expect(result).toBe('Token: [REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer abc123xyz789token';
      const result = redactText(text, []);
      expect(result).toBe('Authorization: [REDACTED]');
    });

    it('should redact SSH private keys', () => {
      const text = `Here is a key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VsG8...secret...
-----END RSA PRIVATE KEY-----
Some text after`;
      const result = redactText(text, []);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('MIIEpAIBAAKCAQEA0Z3VsG8');
    });

    it('should redact multiple secrets in one string', () => {
      // Using patterns that actually match
      const text = 'Keys: token_123456789012345678901234 and AKIAIOSFODNN7EXAMPLE';
      const result = redactText(text, []);
      expect(result).toBe('Keys: [REDACTED] and [REDACTED]');
    });
  });

  describe('custom patterns', () => {
    it('should apply custom regex patterns', () => {
      const customPattern = /secret-\d{4}/gi;
      const text = 'The code is secret-1234 and secret-5678';
      const result = redactText(text, [customPattern]);
      expect(result).toBe('The code is [REDACTED] and [REDACTED]');
    });

    it('should apply multiple custom patterns', () => {
      // Note: first pattern captures "email@example.com," including the comma
      const patterns = [/email@\S+/gi, /phone:\s*\d+-\d+-\d+/gi];
      const text = 'Contact: email@example.com, phone: 555-123-4567';
      const result = redactText(text, patterns);
      // email@example.com, (with comma) is captured by \S+
      expect(result).toBe('Contact: [REDACTED] [REDACTED]');
    });

    it('should handle empty custom patterns array', () => {
      const text = 'Just some regular text without secrets';
      const result = redactText(text, []);
      expect(result).toBe('Just some regular text without secrets');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = redactText('', []);
      expect(result).toBe('');
    });

    it('should handle string with no matches', () => {
      const text = 'Hello, this is a normal message with no secrets';
      const result = redactText(text, []);
      expect(result).toBe(text);
    });
  });
});

describe('redactObject', () => {
  it('should redact strings in flat objects', () => {
    const obj = {
      name: 'John',
      apiKey: 'sk_abc123def456ghi789jkl012mno',
    };
    const result = redactObject(obj, []);
    expect(result).toEqual({
      name: 'John',
      apiKey: '[REDACTED]',
    });
  });

  it('should redact strings in nested objects', () => {
    const obj = {
      user: {
        name: 'John',
        credentials: {
          awsKey: 'AKIAIOSFODNN7EXAMPLE',
        },
      },
    };
    const result = redactObject(obj, []);
    expect(result.user.credentials.awsKey).toBe('[REDACTED]');
    expect(result.user.name).toBe('John');
  });

  it('should redact strings in arrays', () => {
    const obj = {
      secrets: ['token_12345678901234567890abcd', 'normal-value'],
    };
    const result = redactObject(obj, []);
    expect(result.secrets).toEqual(['[REDACTED]', 'normal-value']);
  });

  it('should handle mixed nested structures', () => {
    const obj = {
      level1: {
        array: [
          { key: 'AKIAIOSFODNN7EXAMPLE' },
          { key: 'safe-value' },
        ],
      },
    };
    const result = redactObject(obj, []);
    expect(result.level1.array[0].key).toBe('[REDACTED]');
    expect(result.level1.array[1].key).toBe('safe-value');
  });

  it('should preserve non-string values', () => {
    const obj = {
      count: 42,
      active: true,
      data: null,
      nested: { number: 123 },
    };
    const result = redactObject(obj, []);
    expect(result).toEqual(obj);
  });

  it('should return null for null input', () => {
    const result = redactObject(null, []);
    expect(result).toBeNull();
  });

  it('should return undefined for undefined input', () => {
    const result = redactObject(undefined, []);
    expect(result).toBeUndefined();
  });

  it('should handle standalone string input', () => {
    const result = redactObject('Bearer my-token-here', []);
    expect(result).toBe('[REDACTED]');
  });

  it('should handle array at root level', () => {
    const arr = ['AKIAIOSFODNN7EXAMPLE', 'normal'];
    const result = redactObject(arr, []);
    expect(result).toEqual(['[REDACTED]', 'normal']);
  });
});

describe('processContent', () => {
  describe('with full export mode', () => {
    it('should apply redaction in full mode', () => {
      const config = createTestConfig({ exportMode: 'full' });
      const content = 'API key: secret_abc123def456ghi789jkl012';
      const result = processContent(content, config);
      expect(result).toBe('API key: [REDACTED]');
    });

    it('should apply custom patterns in full mode', () => {
      const config = createTestConfig({
        exportMode: 'full',
        redactPatterns: [/user-\d+/gi],
      });
      const content = 'User ID: user-12345';
      const result = processContent(content, config);
      expect(result).toBe('User ID: [REDACTED]');
    });

    it('should return undefined for undefined content', () => {
      const config = createTestConfig({ exportMode: 'full' });
      const result = processContent(undefined, config);
      expect(result).toBeUndefined();
    });

    it('should return empty string for empty content', () => {
      const config = createTestConfig({ exportMode: 'full' });
      const result = processContent('', config);
      expect(result).toBe('');
    });
  });

  describe('with metadata_only export mode', () => {
    it('should return undefined regardless of content', () => {
      const config = createTestConfig({ exportMode: 'metadata_only' });
      const content = 'This should be stripped entirely';
      const result = processContent(content, config);
      expect(result).toBeUndefined();
    });

    it('should return undefined even for empty content', () => {
      const config = createTestConfig({ exportMode: 'metadata_only' });
      const result = processContent('', config);
      expect(result).toBeUndefined();
    });
  });
});

describe('processObject', () => {
  describe('with full export mode', () => {
    it('should apply redaction to objects', () => {
      const config = createTestConfig({ exportMode: 'full' });
      const obj = {
        message: 'Secret: AKIAIOSFODNN7EXAMPLE',
      };
      const result = processObject(obj, config);
      expect(result?.message).toBe('Secret: [REDACTED]');
    });
  });

  describe('with metadata_only export mode', () => {
    it('should return undefined for any object', () => {
      const config = createTestConfig({ exportMode: 'metadata_only' });
      const obj = { data: 'some data' };
      const result = processObject(obj, config);
      expect(result).toBeUndefined();
    });
  });
});
