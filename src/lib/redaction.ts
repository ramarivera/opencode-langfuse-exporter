/**
 * Redaction utilities for privacy controls.
 *
 * Supports:
 * - Custom regex patterns for redacting sensitive data
 * - Built-in patterns for common secrets (API keys, tokens, etc.)
 * - metadata_only mode that strips all content
 */

import type { LangfuseExporterConfig } from './config';

/** Built-in patterns for common sensitive data */
const BUILTIN_REDACT_PATTERNS: RegExp[] = [
  // API keys (generic patterns)
  /\b(sk|pk|api|key|token|secret|password|auth)[_-]?[a-zA-Z0-9]{20,}\b/gi,
  // AWS keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  // JWT tokens
  /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
  // Bearer tokens in headers
  /Bearer\s+[a-zA-Z0-9_.-]+/gi,
  // SSH private keys
  /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Apply redaction patterns to a string.
 *
 * @param text - The text to redact
 * @param patterns - Array of regex patterns to apply
 * @returns Redacted text with matches replaced by [REDACTED]
 */
export function redactText(text: string, patterns: RegExp[]): string {
  let result = text;

  // Apply built-in patterns
  for (const pattern of BUILTIN_REDACT_PATTERNS) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER);
  }

  // Apply custom patterns
  for (const pattern of patterns) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER);
  }

  return result;
}

/**
 * Recursively redact sensitive data from an object.
 *
 * @param obj - The object to redact
 * @param patterns - Array of regex patterns to apply
 * @returns A new object with redacted values
 */
export function redactObject<T>(obj: T, patterns: RegExp[]): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactText(obj, patterns) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, patterns)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = redactObject(value, patterns);
    }
    return result as T;
  }

  return obj;
}

/**
 * Process content based on export mode and redaction settings.
 *
 * @param content - The content to process
 * @param config - Exporter configuration
 * @returns Processed content based on export mode
 */
export function processContent(
  content: string | undefined,
  config: LangfuseExporterConfig
): string | undefined {
  if (config.exportMode === 'metadata_only') {
    return undefined;
  }

  if (!content) {
    return content;
  }

  return redactText(content, config.redactPatterns);
}

/**
 * Process an object based on export mode and redaction settings.
 *
 * @param obj - The object to process
 * @param config - Exporter configuration
 * @returns Processed object based on export mode
 */
export function processObject<T>(obj: T, config: LangfuseExporterConfig): T | undefined {
  if (config.exportMode === 'metadata_only') {
    return undefined;
  }

  return redactObject(obj, config.redactPatterns);
}
