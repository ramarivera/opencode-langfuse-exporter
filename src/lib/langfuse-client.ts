/**
 * Langfuse client wrapper with resilient error handling.
 *
 * This module provides a wrapper around the Langfuse SDK that:
 * - Handles connection failures gracefully
 * - Uses the built-in batching/flushing mechanism
 * - Falls back to disk spool on failures
 * - Provides async shutdown for graceful exit
 * - Never throws uncaught exceptions
 */

import Langfuse from 'langfuse';

import type { LangfuseExporterConfig } from './config';
import { enableVerbose, logDebug, logError, logInfo } from './logger';
import { generateIdempotencyKey } from './session-id';
import type { SpooledEventData } from './spool';
import {
  createSpooledEvent,
  initSpool,
  loadPendingEvents,
  markProcessed,
  writeToSpool,
} from './spool';

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
  traceId: string;
  name: string;
  model?: string;
  modelParameters?: Record<string, string | number | boolean | null>;
  input?: unknown;
  output?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  metadata?: Record<string, string | number | boolean | string[] | null>;
  startTime?: Date;
  endTime?: Date;
}

export interface SpanData {
  traceId: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, string | number | boolean | string[] | null>;
  startTime?: Date;
  endTime?: Date;
}

interface LangfuseClientState {
  client: Langfuse | null;
  isConnected: boolean;
  pendingRetries: number;
  lastError: Error | null;
}

const state: LangfuseClientState = {
  client: null,
  isConnected: false,
  pendingRetries: 0,
  lastError: null,
};

let config: LangfuseExporterConfig | null = null;
let retryTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

/**
 * Initialize the Langfuse client
 */
export async function initLangfuseClient(cfg: LangfuseExporterConfig): Promise<boolean> {
  config = cfg;

  // Enable verbose logging if configured
  if (cfg.verbose) {
    enableVerbose();
  }

  if (cfg.exportMode === 'off') {
    logInfo('Export mode is off, skipping Langfuse initialization');
    return false;
  }

  // Initialize spool directory
  await initSpool(cfg);

  // Try to connect to Langfuse
  try {
    state.client = new Langfuse({
      publicKey: cfg.publicKey,
      secretKey: cfg.secretKey,
      baseUrl: cfg.host,
      flushAt: 15, // Batch 15 events before flushing
      flushInterval: cfg.flushInterval,
    });

    state.isConnected = true;
    logInfo('Langfuse client initialized successfully', { host: cfg.host });

    // Process any pending events from disk
    await processPendingEvents();

    return true;
  } catch (error) {
    state.lastError = error instanceof Error ? error : new Error(String(error));
    logError(error, 'Failed to initialize Langfuse client');
    state.isConnected = false;
    return false;
  }
}

/**
 * Create a trace in Langfuse
 */
export async function createTrace(data: TraceData): Promise<void> {
  if (!config || config.exportMode === 'off') return;

  const idempotencyKey = generateIdempotencyKey(data.sessionId, 'trace', data.id);

  try {
    if (state.client && state.isConnected) {
      state.client.trace({
        id: data.id,
        sessionId: data.sessionId,
        name: data.name,
        metadata: data.metadata,
        input: data.input,
        output: data.output,
        userId: data.userId,
        tags: data.tags,
      });
      logDebug('Trace created', { name: data.name, sessionId: data.sessionId });
    } else {
      // Spool for later
      await spoolEvent('trace', data.sessionId, idempotencyKey, data);
    }
  } catch (error) {
    logError(error, 'Failed to create trace');
    await spoolEvent('trace', data.sessionId, idempotencyKey, data);
  }
}

/**
 * Create a generation in Langfuse
 */
export async function createGeneration(data: GenerationData): Promise<void> {
  if (!config || config.exportMode === 'off') return;

  const idempotencyKey = generateIdempotencyKey(data.traceId, 'generation', data.name);

  try {
    if (state.client && state.isConnected) {
      state.client.generation({
        traceId: data.traceId,
        name: data.name,
        model: data.model,
        modelParameters: data.modelParameters,
        input: data.input,
        output: data.output,
        usage: data.usage,
        metadata: data.metadata,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      logDebug('Generation created', { name: data.name, traceId: data.traceId });
    } else {
      await spoolEvent('generation', data.traceId, idempotencyKey, data);
    }
  } catch (error) {
    logError(error, 'Failed to create generation');
    await spoolEvent('generation', data.traceId, idempotencyKey, data);
  }
}

/**
 * Create a span in Langfuse
 */
export async function createSpan(data: SpanData): Promise<void> {
  if (!config || config.exportMode === 'off') return;

  const idempotencyKey = generateIdempotencyKey(data.traceId, 'span', data.name);

  try {
    if (state.client && state.isConnected) {
      state.client.span({
        traceId: data.traceId,
        name: data.name,
        input: data.input,
        output: data.output,
        metadata: data.metadata,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      logDebug('Span created', { name: data.name, traceId: data.traceId });
    } else {
      await spoolEvent('span', data.traceId, idempotencyKey, data);
    }
  } catch (error) {
    logError(error, 'Failed to create span');
    await spoolEvent('span', data.traceId, idempotencyKey, data);
  }
}

/**
 * Spool an event for later processing
 */
async function spoolEvent(
  type: 'trace' | 'generation' | 'span',
  sessionId: string,
  idempotencyKey: string,
  data: TraceData | GenerationData | SpanData
): Promise<void> {
  if (!config) return;

  try {
    const event = createSpooledEvent(
      type,
      sessionId,
      idempotencyKey,
      data as unknown as SpooledEventData
    );
    await writeToSpool(event, config);
    logDebug('Event spooled for later', { type, idempotencyKey });

    // Schedule retry if not already scheduled
    scheduleRetry();
  } catch (error) {
    logError(error, 'Failed to spool event');
    // Never throw - we can't do anything if spooling fails
  }
}

/**
 * Schedule a retry of pending events
 */
function scheduleRetry(): void {
  if (retryTimeoutId || !config) return;

  retryTimeoutId = globalThis.setTimeout(async () => {
    retryTimeoutId = null;
    await processPendingEvents();
  }, config.flushInterval * 2);
}

/**
 * Process pending events from the spool
 */
async function processPendingEvents(): Promise<void> {
  if (!config || !state.client || !state.isConnected) return;

  try {
    const { pendingEvents } = await loadPendingEvents(config);

    if (pendingEvents.length === 0) {
      logDebug('No pending events to process');
      return;
    }

    logInfo('Processing pending events', { count: pendingEvents.length });

    for (const event of pendingEvents) {
      try {
        switch (event.type) {
          case 'trace':
            state.client.trace(event.data as Parameters<typeof state.client.trace>[0]);
            break;
          case 'generation':
            state.client.generation(event.data as Parameters<typeof state.client.generation>[0]);
            break;
          case 'span':
            state.client.span(event.data as Parameters<typeof state.client.span>[0]);
            break;
        }
        await markProcessed(event.idempotencyKey, config);
        logDebug('Processed pending event', {
          type: event.type,
          idempotencyKey: event.idempotencyKey,
        });
      } catch (error) {
        logError(error, `Failed to process pending event ${event.idempotencyKey}`);
        // Will retry on next cycle - don't throw
      }
    }
  } catch (error) {
    logError(error, 'Failed to process pending events');
    // Never throw
  }
}

/**
 * Flush all pending events and shutdown the client
 */
export async function shutdownLangfuseClient(): Promise<void> {
  if (retryTimeoutId) {
    globalThis.clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }

  if (state.client) {
    try {
      logInfo('Flushing Langfuse client...');
      await state.client.shutdownAsync();
      logInfo('Langfuse client shutdown complete');
    } catch (error) {
      logError(error, 'Error during Langfuse shutdown');
      // Never throw during shutdown
    }
  }

  state.client = null;
  state.isConnected = false;
}

/**
 * Get the current connection status
 */
export function getStatus(): {
  connected: boolean;
  pendingRetries: number;
  lastError: string | null;
} {
  return {
    connected: state.isConnected,
    pendingRetries: state.pendingRetries,
    lastError: state.lastError?.message ?? null,
  };
}
