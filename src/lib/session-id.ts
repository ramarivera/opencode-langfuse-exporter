/**
 * Utilities for generating deterministic session and trace IDs.
 *
 * Following the pattern from opencode-helicone-session plugin,
 * we generate stable UUIDs from OpenCode session IDs for correlation.
 */

import { createHash } from 'node:crypto';

/**
 * Generate a deterministic hash from a string using SHA-256.
 * Works in both Bun and Node.js environments.
 */
function hashString(input: string): string {
  const hash = createHash('sha256');
  hash.update(input);
  return hash.digest('hex');
}

/**
 * Converts an OpenCode session ID to a deterministic UUID format.
 * Uses SHA-256 hash to generate a consistent UUID from the session ID.
 *
 * @param sessionId - The OpenCode session ID
 * @returns A UUID v4-like string (deterministic based on input)
 */
export function sessionToUUID(sessionId: string): string {
  const hashHex = hashString(sessionId);

  // Take first 32 chars of hex for UUID (128 bits)
  const fullHex = hashHex.slice(0, 32);

  // Format as UUID
  return [
    fullHex.slice(0, 8),
    fullHex.slice(8, 12),
    fullHex.slice(12, 16),
    fullHex.slice(16, 20),
    fullHex.slice(20, 32),
  ].join('-');
}

/**
 * Generates a deterministic trace ID from session ID and optional message ID.
 * This ensures the same trace ID is generated for the same inputs.
 *
 * @param sessionId - The OpenCode session ID
 * @param messageId - Optional message ID for sub-trace correlation
 * @returns A deterministic trace ID
 */
export function generateTraceId(sessionId: string, messageId?: string): string {
  const input = messageId ? `${sessionId}:${messageId}` : sessionId;
  return sessionToUUID(input);
}

/**
 * Generates a deterministic idempotency key for deduplication.
 * Uses session ID, event type, and identifier to create a unique key.
 *
 * @param sessionId - The OpenCode session ID
 * @param eventType - Type of event (e.g., 'message', 'tool-call')
 * @param identifier - Unique identifier within the event (e.g., messageId, callId)
 * @returns A hash suitable for idempotency checking
 */
export function generateIdempotencyKey(
  sessionId: string,
  eventType: string,
  identifier: string
): string {
  const input = `${sessionId}:${eventType}:${identifier}`;
  const hashHex = hashString(input);
  return hashHex.slice(0, 16);
}

/**
 * Sanitizes a string for use in trace names and metadata.
 * Removes control characters and trims whitespace.
 *
 * @param value - The string to sanitize
 * @returns A sanitized string safe for use in trace metadata
 */
export function sanitizeForTrace(value: string): string {
  // Remove control characters: carriage return, newline, and control chars
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Skip control characters (0x00-0x1f except \t, \n, \r) and DEL (0x7f)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      // Replace tabs, newlines, carriage returns with space
      result += ' ';
    } else if (code >= 0x20 && code !== 0x7f) {
      result += value[i];
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}
