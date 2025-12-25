import { describe, expect, it } from 'vitest';

import {
  generateIdempotencyKey,
  generateTraceId,
  sanitizeForTrace,
  sessionToUUID,
} from '../src/lib/session-id';

describe('session-id', () => {
  describe('sessionToUUID', () => {
    it('should produce consistent UUIDs for the same session ID', () => {
      const sessionId = 'test-session-123';
      const uuid1 = sessionToUUID(sessionId);
      const uuid2 = sessionToUUID(sessionId);

      expect(uuid1).toBe(uuid2);
    });

    it('should produce different UUIDs for different session IDs', () => {
      const uuid1 = sessionToUUID('session-a');
      const uuid2 = sessionToUUID('session-b');

      expect(uuid1).not.toBe(uuid2);
    });

    it('should produce valid UUID format', () => {
      const uuid = sessionToUUID('any-session');
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(uuid).toMatch(uuidRegex);
    });

    it('should handle empty string', () => {
      const uuid = sessionToUUID('');
      expect(uuid).toBeDefined();
      expect(uuid.length).toBe(36); // UUID length with dashes
    });
  });

  describe('generateTraceId', () => {
    it('should produce consistent trace IDs for the same inputs', () => {
      const traceId1 = generateTraceId('session-1', 'message-1');
      const traceId2 = generateTraceId('session-1', 'message-1');

      expect(traceId1).toBe(traceId2);
    });

    it('should produce different trace IDs for different message IDs', () => {
      const traceId1 = generateTraceId('session-1', 'message-1');
      const traceId2 = generateTraceId('session-1', 'message-2');

      expect(traceId1).not.toBe(traceId2);
    });

    it('should work without message ID', () => {
      const traceId1 = generateTraceId('session-1');
      const traceId2 = generateTraceId('session-1');

      expect(traceId1).toBe(traceId2);
    });

    it('should produce different results with and without message ID', () => {
      const traceIdWithMessage = generateTraceId('session-1', 'message-1');
      const traceIdWithoutMessage = generateTraceId('session-1');

      expect(traceIdWithMessage).not.toBe(traceIdWithoutMessage);
    });
  });

  describe('generateIdempotencyKey', () => {
    it('should produce deterministic keys', () => {
      const key1 = generateIdempotencyKey('session-1', 'trace', 'id-123');
      const key2 = generateIdempotencyKey('session-1', 'trace', 'id-123');

      expect(key1).toBe(key2);
    });

    it('should produce different keys for different event types', () => {
      const key1 = generateIdempotencyKey('session-1', 'trace', 'id-123');
      const key2 = generateIdempotencyKey('session-1', 'generation', 'id-123');

      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different identifiers', () => {
      const key1 = generateIdempotencyKey('session-1', 'span', 'tool-read');
      const key2 = generateIdempotencyKey('session-1', 'span', 'tool-write');

      expect(key1).not.toBe(key2);
    });

    it('should produce keys of consistent length', () => {
      const key1 = generateIdempotencyKey('short', 'trace', 'id');
      const key2 = generateIdempotencyKey(
        'a-very-long-session-id-that-is-much-longer',
        'trace',
        'id'
      );

      expect(key1.length).toBe(key2.length);
      expect(key1.length).toBe(16); // Expected length from padStart(16, '0')
    });
  });

  describe('sanitizeForTrace', () => {
    it('should trim whitespace', () => {
      expect(sanitizeForTrace('  hello world  ')).toBe('hello world');
    });

    it('should replace newlines with spaces', () => {
      expect(sanitizeForTrace('hello\nworld')).toBe('hello world');
    });

    it('should replace carriage returns with spaces', () => {
      expect(sanitizeForTrace('hello\rworld')).toBe('hello world');
    });

    it('should replace tabs with spaces', () => {
      expect(sanitizeForTrace('hello\tworld')).toBe('hello world');
    });

    it('should collapse multiple whitespace into single space', () => {
      expect(sanitizeForTrace('hello   world')).toBe('hello world');
      expect(sanitizeForTrace('hello\n\n\nworld')).toBe('hello world');
    });

    it('should remove control characters', () => {
      // Control characters like \x00-\x1f (except \t, \n, \r)
      expect(sanitizeForTrace('hello\x00world')).toBe('helloworld');
      expect(sanitizeForTrace('hello\x1fworld')).toBe('helloworld');
    });

    it('should handle empty string', () => {
      expect(sanitizeForTrace('')).toBe('');
    });

    it('should preserve normal text', () => {
      expect(sanitizeForTrace('Hello World!')).toBe('Hello World!');
    });
  });
});
