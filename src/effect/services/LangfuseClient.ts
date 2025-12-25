/**
 * LangfuseClient service - Effect wrapper for Langfuse SDK.
 *
 * Provides retry logic with exponential backoff and graceful degradation.
 */

import { Context, Effect, Layer, Schedule } from 'effect';
import Langfuse from 'langfuse';

import { loadConfig, type LangfuseExporterConfig } from '../../lib/config.js';
import { MAX_RETRY_ATTEMPTS, RETRY_BASE_DELAY, RETRY_MAX_DELAY } from '../constants.js';
import { LangfuseApiError } from '../errors.js';

// Re-export data types from the old client
export interface TraceData {
  id: string;
  sessionId: string;
  name: string;
  metadata?: Record<string, string | number | boolean | string[] | null>;
  input?: unknown;
  output?: unknown;
  userId?: string;
  tags?: string[];
}

export interface GenerationData {
  id?: string;
  traceId: string;
  parentObservationId?: string;
  name: string;
  model?: string;
  modelParameters?: Record<string, string | number | boolean | null>;
  input?: unknown;
  output?: unknown;
  /** @deprecated Use usageDetails instead */
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /**
   * Detailed usage metrics (tokens).
   * Keys: input, output, total, reasoning, cache_read, cache_write, etc.
   */
  usageDetails?: Record<string, number>;
  /**
   * Cost details in USD.
   * Keys: total, input, output, etc.
   */
  costDetails?: Record<string, number>;
  metadata?: Record<string, string | number | boolean | string[] | null>;
  startTime?: Date;
  endTime?: Date;
}

export interface SpanData {
  id?: string;
  traceId: string;
  parentObservationId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, string | number | boolean | string[] | null>;
  startTime?: Date;
  endTime?: Date;
}

/**
 * LangfuseClient service interface.
 */
export interface LangfuseClient {
  /**
   * Create a trace in Langfuse.
   */
  readonly createTrace: (data: TraceData) => Effect.Effect<void, LangfuseApiError>;

  /**
   * Create a generation (LLM call) in Langfuse.
   */
  readonly createGeneration: (data: GenerationData) => Effect.Effect<void, LangfuseApiError>;

  /**
   * Create a span (tool call, operation) in Langfuse.
   */
  readonly createSpan: (data: SpanData) => Effect.Effect<void, LangfuseApiError>;

  /**
   * Flush pending events to Langfuse.
   */
  readonly flush: Effect.Effect<void, LangfuseApiError>;

  /**
   * Shutdown the client gracefully.
   */
  readonly shutdown: Effect.Effect<void, LangfuseApiError>;

  /**
   * Check if the client is connected.
   */
  readonly isConnected: Effect.Effect<boolean>;

  /**
   * Get the current config.
   */
  readonly config: LangfuseExporterConfig;
}

/**
 * LangfuseClient service tag for dependency injection.
 */
export const LangfuseClient = Context.GenericTag<LangfuseClient>('LangfuseClient');

/**
 * Retry schedule for Langfuse API calls.
 * Exponential backoff with jitter, capped at max delay, limited to N attempts.
 *
 * Pattern: exponential(base) -> jittered -> capped -> limited
 */
const retrySchedule = Schedule.exponential(RETRY_BASE_DELAY).pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.spaced(RETRY_MAX_DELAY)), // Cap max delay
  Schedule.upTo(MAX_RETRY_ATTEMPTS) // Limit total attempts
);

type LangfuseOperation = 'createTrace' | 'createGeneration' | 'createSpan' | 'flush' | 'shutdown';

/**
 * Create a LangfuseApiError from an unknown error.
 */
function toLangfuseError(error: unknown, operation: LangfuseOperation): LangfuseApiError {
  return new LangfuseApiError({
    message: error instanceof Error ? error.message : String(error),
    operation,
    cause: error,
    retryable: true,
  });
}

/**
 * Wrap a synchronous Langfuse SDK call with retry logic.
 * Use this for operations that don't return a Promise (trace, generation, span creation).
 */
function withRetrySync<A>(
  operation: LangfuseOperation,
  fn: () => A
): Effect.Effect<A, LangfuseApiError> {
  return Effect.try({
    try: fn,
    catch: (error) => toLangfuseError(error, operation),
  }).pipe(
    Effect.retry(retrySchedule),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Langfuse ${operation} failed after retries`, {
          error: error.message,
          operation,
        });
        return yield* Effect.fail(error);
      })
    )
  );
}

/**
 * Wrap an asynchronous Langfuse SDK call with retry logic.
 * Use this for operations that return a Promise (flush, shutdown).
 */
function withRetryAsync<A>(
  operation: LangfuseOperation,
  fn: () => Promise<A>
): Effect.Effect<A, LangfuseApiError> {
  return Effect.tryPromise({
    try: fn,
    catch: (error) => toLangfuseError(error, operation),
  }).pipe(
    Effect.retry(retrySchedule),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Langfuse ${operation} failed after retries`, {
          error: error.message,
          operation,
        });
        return yield* Effect.fail(error);
      })
    )
  );
}

/**
 * Live implementation of LangfuseClient.
 */
export const LangfuseClientLive = Layer.effect(
  LangfuseClient,
  Effect.gen(function* () {
    // Load config
    const config = yield* Effect.try({
      try: () => loadConfig({}),
      catch: (error) =>
        new LangfuseApiError({
          message: `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
          operation: 'createTrace',
          cause: error,
          retryable: false,
        }),
    });

    // Check if export is off
    if (config.exportMode === 'off') {
      yield* Effect.logInfo('Langfuse export mode is off, client disabled');
      return LangfuseClient.of({
        createTrace: () => Effect.void,
        createGeneration: () => Effect.void,
        createSpan: () => Effect.void,
        flush: Effect.void,
        shutdown: Effect.void,
        isConnected: Effect.succeed(false),
        config,
      });
    }

    // Initialize Langfuse SDK
    const client = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.host,
      flushAt: 15,
      flushInterval: config.flushInterval,
    });

    yield* Effect.logInfo('Langfuse client initialized', { host: config.host });

    return LangfuseClient.of({
      createTrace: (data) =>
        withRetrySync('createTrace', () => {
          client.trace({
            id: data.id,
            sessionId: data.sessionId,
            name: data.name,
            metadata: data.metadata,
            input: data.input,
            output: data.output,
            userId: data.userId,
            tags: data.tags,
          });
        }).pipe(Effect.tap(() => Effect.logDebug('Trace created', { name: data.name }))),

      createGeneration: (data) =>
        withRetrySync('createGeneration', () => {
          client.generation({
            id: data.id,
            traceId: data.traceId,
            parentObservationId: data.parentObservationId,
            name: data.name,
            model: data.model,
            modelParameters: data.modelParameters,
            input: data.input,
            output: data.output,
            usage: data.usage,
            usageDetails: data.usageDetails,
            costDetails: data.costDetails,
            metadata: data.metadata,
            startTime: data.startTime,
            endTime: data.endTime,
          });
        }).pipe(Effect.tap(() => Effect.logDebug('Generation created', { name: data.name }))),

      createSpan: (data) =>
        withRetrySync('createSpan', () => {
          client.span({
            id: data.id,
            traceId: data.traceId,
            parentObservationId: data.parentObservationId,
            name: data.name,
            input: data.input,
            output: data.output,
            metadata: data.metadata,
            startTime: data.startTime,
            endTime: data.endTime,
          });
        }).pipe(Effect.tap(() => Effect.logDebug('Span created', { name: data.name }))),

      flush: withRetryAsync('flush', () => client.flushAsync()).pipe(
        Effect.tap(() => Effect.logDebug('Flush completed'))
      ),

      shutdown: withRetryAsync('shutdown', () => client.shutdownAsync()).pipe(
        Effect.tap(() => Effect.logInfo('Langfuse client shutdown complete'))
      ),

      isConnected: Effect.succeed(true),

      config,
    });
  })
);

/**
 * Test implementation that logs but doesn't send to Langfuse.
 */
export const LangfuseClientTest = (config: LangfuseExporterConfig) =>
  Layer.succeed(
    LangfuseClient,
    LangfuseClient.of({
      createTrace: (data) =>
        Effect.logDebug('[TEST] Trace created', { name: data.name, sessionId: data.sessionId }),
      createGeneration: (data) =>
        Effect.logDebug('[TEST] Generation created', { name: data.name, traceId: data.traceId }),
      createSpan: (data) =>
        Effect.logDebug('[TEST] Span created', { name: data.name, traceId: data.traceId }),
      flush: Effect.logDebug('[TEST] Flush called'),
      shutdown: Effect.logDebug('[TEST] Shutdown called'),
      isConnected: Effect.succeed(true),
      config,
    })
  );
