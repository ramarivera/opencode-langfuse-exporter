/**
 * Effect.ts configuration constants for the Langfuse exporter plugin.
 *
 * These values control streaming, retry, and queue behavior.
 */

import { Duration } from 'effect';

// --- Debounce Configuration ---

/**
 * Duration to wait after the last event update before emitting.
 * This consolidates streaming chunks into a single observation.
 *
 * Rationale: 10 seconds is long enough to capture all streaming chunks
 * for a typical LLM response, but not so long that it delays feedback.
 */
export const DEBOUNCE_DURATION = Duration.seconds(10);

// --- Queue Configuration ---

/**
 * Maximum number of events that can be queued before backpressure kicks in.
 * When the queue is full, producers will block until space is available.
 *
 * Rationale: 1000 events provides ample buffer for burst traffic while
 * preventing unbounded memory growth.
 */
export const QUEUE_CAPACITY = 1000;

// --- Retry Configuration ---

/**
 * Maximum number of retry attempts for Langfuse API calls.
 * After this many failures, the event is dropped and logged.
 *
 * Rationale: 5 attempts with exponential backoff covers transient network
 * issues without blocking the pipeline indefinitely.
 */
export const MAX_RETRY_ATTEMPTS = 5;

/**
 * Initial delay between retry attempts (before exponential backoff).
 */
export const RETRY_BASE_DELAY = Duration.seconds(1);

/**
 * Maximum delay between retry attempts (cap for exponential backoff).
 */
export const RETRY_MAX_DELAY = Duration.seconds(30);

// --- Logging Configuration ---

/**
 * Log file location for the plugin.
 */
export const LOG_DIR = '~/.opencode/langfuse-exporter/logs';

/**
 * Log file name pattern.
 */
export const LOG_FILE = 'langfuse-exporter.log';
