/**
 * Custom Effect errors for the Langfuse exporter plugin.
 *
 * These typed errors enable proper error handling and recovery strategies.
 */

import { Data } from 'effect';

/**
 * Error when Langfuse API call fails.
 * Includes context about the operation for retry decisions.
 */
export class LangfuseApiError extends Data.TaggedError('LangfuseApiError')<{
  readonly message: string;
  readonly operation: 'createTrace' | 'createGeneration' | 'createSpan' | 'flush' | 'shutdown';
  readonly cause?: unknown;
  readonly retryable: boolean;
}> {}

/**
 * Error when configuration is invalid or missing.
 */
export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{
  readonly message: string;
  readonly field?: string;
}> {}

/**
 * Error when event processing fails.
 */
export class EventProcessingError extends Data.TaggedError('EventProcessingError')<{
  readonly message: string;
  readonly eventType: string;
  readonly cause?: unknown;
}> {}

/**
 * Error when queue operations fail (e.g., queue full with timeout).
 */
export class QueueError extends Data.TaggedError('QueueError')<{
  readonly message: string;
  readonly operation: 'offer' | 'take' | 'shutdown';
}> {}

/**
 * Error when session state is inconsistent.
 */
export class SessionStateError extends Data.TaggedError('SessionStateError')<{
  readonly message: string;
  readonly sessionId: string;
}> {}

/**
 * Union type of all plugin errors for exhaustive handling.
 */
export type PluginError =
  | LangfuseApiError
  | ConfigurationError
  | EventProcessingError
  | QueueError
  | SessionStateError;
