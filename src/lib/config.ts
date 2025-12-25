/**
 * Configuration for the Langfuse exporter plugin.
 *
 * Supports configuration via:
 * 1. Environment variables (preferred)
 * 2. Plugin config in opencode.json
 */

export type ExportMode = 'full' | 'metadata_only' | 'off';

export interface LangfuseExporterConfig {
  /** Langfuse public key (required) */
  publicKey: string;
  /** Langfuse secret key (required) */
  secretKey: string;
  /** Langfuse host URL (default: https://cloud.langfuse.com) */
  host: string;
  /** Export mode: 'full' | 'metadata_only' | 'off' */
  exportMode: ExportMode;
  /** Comma-separated regex patterns for redaction */
  redactPatterns: RegExp[];
  /** Flush interval in milliseconds (default: 5000) */
  flushInterval: number;
  /** Directory for local spool/queue (default: ~/.opencode/langfuse-spool) */
  spoolDir: string;
  /** Maximum spool size in MB (default: 100) */
  maxSpoolSizeMB: number;
  /** Retention days for spool files (default: 7) */
  retentionDays: number;
  /** Trace name prefix */
  traceNamePrefix: string;
  /** Enable verbose logging */
  verbose: boolean;
  /** Enable plugin (default: true) */
  enabled: boolean;
}

// Store invalid patterns for later logging (can't import logger here due to circular deps)
const invalidPatterns: string[] = [];

/**
 * Get any invalid patterns that were encountered during config parsing
 */
export function getInvalidPatterns(): string[] {
  return [...invalidPatterns];
}

/**
 * Parse comma-separated regex patterns from string
 */
function parseRedactPatterns(input: string | undefined): RegExp[] {
  if (!input) return [];
  return input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'gi');
      } catch {
        // Store for later logging - can't log here due to initialization order
        invalidPatterns.push(pattern);
        return null;
      }
    })
    .filter((p): p is RegExp => p !== null);
}

/**
 * Get the default spool directory
 */
function getDefaultSpoolDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return `${home}/.opencode/langfuse-spool`;
}

/**
 * Load configuration from environment variables and optional config object
 */
export function loadConfig(pluginConfig?: Partial<LangfuseExporterConfig>): LangfuseExporterConfig {
  const env = process.env;

  return {
    publicKey: env.LANGFUSE_PUBLIC_KEY || pluginConfig?.publicKey || '',
    secretKey: env.LANGFUSE_SECRET_KEY || pluginConfig?.secretKey || '',
    host: env.LANGFUSE_HOST || pluginConfig?.host || 'https://cloud.langfuse.com',
    exportMode: (env.OPENCODE_LANGFUSE_EXPORT_MODE ||
      pluginConfig?.exportMode ||
      'full') as ExportMode,
    redactPatterns:
      parseRedactPatterns(env.OPENCODE_LANGFUSE_REDACT_REGEX) || pluginConfig?.redactPatterns || [],
    flushInterval: parseInt(
      env.OPENCODE_LANGFUSE_FLUSH_INTERVAL || String(pluginConfig?.flushInterval || 5000),
      10
    ),
    spoolDir: env.OPENCODE_LANGFUSE_SPOOL_DIR || pluginConfig?.spoolDir || getDefaultSpoolDir(),
    maxSpoolSizeMB: parseInt(
      env.OPENCODE_LANGFUSE_MAX_SPOOL_MB || String(pluginConfig?.maxSpoolSizeMB || 100),
      10
    ),
    retentionDays: parseInt(
      env.OPENCODE_LANGFUSE_RETENTION_DAYS || String(pluginConfig?.retentionDays || 7),
      10
    ),
    traceNamePrefix: env.OPENCODE_LANGFUSE_TRACE_PREFIX || pluginConfig?.traceNamePrefix || '',
    verbose: env.OPENCODE_LANGFUSE_VERBOSE === 'true' || pluginConfig?.verbose || false,
    enabled: env.OPENCODE_LANGFUSE_ENABLED !== 'false' && (pluginConfig?.enabled ?? true),
  };
}

/**
 * Validate that required configuration is present
 */
export function validateConfig(config: LangfuseExporterConfig): string[] {
  const errors: string[] = [];

  if (config.exportMode !== 'off') {
    if (!config.publicKey) {
      errors.push('LANGFUSE_PUBLIC_KEY is required');
    }
    if (!config.secretKey) {
      errors.push('LANGFUSE_SECRET_KEY is required');
    }
  }

  return errors;
}
