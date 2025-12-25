/**
 * EventProcessor - Main stream pipeline for processing OpenCode events.
 *
 * This is the core of the fix for duplicate observations. It uses a
 * debounce-based approach with state tracking to consolidate streaming
 * events into final observations.
 *
 * Strategy:
 * 1. Events come in through the queue
 * 2. For each event key, we track the latest event and a timeout
 * 3. When no updates arrive for 10s, we process the final state
 * 4. ProcessedIds prevents re-processing the same event
 */

import { Effect, Fiber, HashMap, Option, Ref, Stream } from 'effect';

import { DEBOUNCE_DURATION } from '../constants.js';
import { EventQueue } from '../services/EventQueue.js';
import { ProcessedIds } from '../services/ProcessedIds.js';
import { SessionState } from '../services/SessionState.js';
import { LangfuseClient } from '../services/LangfuseClient.js';
import { getEventKey, type ModelParams, type PluginEvent, type TraceState } from './types.js';
import { redactObject, redactText } from '../../lib/redaction.js';
import { sessionToUUID } from '../../lib/session-id.js';

/**
 * State for tracking pending events and their debounce timers.
 */
interface DebounceState {
  /** Latest event for each key */
  readonly events: HashMap.HashMap<string, PluginEvent>;
  /** Debounce timers (fibers) for each key */
  readonly timers: HashMap.HashMap<string, Fiber.RuntimeFiber<void, never>>;
}

/**
 * Create the main event processing stream.
 */
export const createEventProcessor = Effect.gen(function* () {
  const eventQueue = yield* EventQueue;
  const processedIds = yield* ProcessedIds;
  const sessionState = yield* SessionState;
  const langfuseClient = yield* LangfuseClient;

  // Get redaction config
  const config = langfuseClient.config;
  const redactPatterns = config.redactPatterns;

  // Debounce state
  const stateRef = yield* Ref.make<DebounceState>({
    events: HashMap.empty(),
    timers: HashMap.empty(),
  });

  /**
   * Apply redaction to content.
   */
  const applyRedaction = (content: string | undefined): string | undefined => {
    if (!content) return content;
    if (config.exportMode === 'metadata_only') return '[REDACTED]';
    return redactText(content, redactPatterns);
  };

  /**
   * Apply redaction to objects.
   */
  const applyObjectRedaction = <T>(obj: T): T => {
    if (!obj) return obj;
    if (config.exportMode === 'metadata_only') return '[REDACTED]' as T;
    return redactObject(obj, redactPatterns) as T;
  };

  /**
   * Process a single event (called after debounce).
   */
  const processEvent = (event: PluginEvent): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const eventKey = getEventKey(event);

      // Check if already processed
      const isNew = yield* processedIds.add(eventKey);
      if (!isNew) {
        yield* Effect.logDebug('Event already processed, skipping', { eventKey });
        return;
      }

      yield* Effect.logDebug('Processing event', {
        type: event.type,
        eventKey,
        sessionId: event.sessionId,
      });

      // Handle event based on type
      if (event.type === 'session.created' || event.type === 'session.updated') {
        const title = 'title' in event ? (event.title as string | undefined) : undefined;
        yield* handleSessionEvent(
          event.sessionId,
          event.type,
          title,
          sessionState,
          langfuseClient,
          applyRedaction
        );
      } else if (event.type === 'session.delete') {
        yield* handleSessionDelete(event.sessionId, sessionState, langfuseClient);
      } else if (event.type === 'message.updated') {
        yield* handleMessageEvent(
          event.sessionId,
          event.messageId,
          event.role,
          event.model,
          event.usage,
          event.parentId,
          event.cost,
          event.time,
          sessionState,
          langfuseClient
        );
      } else if (event.type === 'message.part.updated') {
        yield* handleMessagePartEvent(
          event.sessionId,
          event.messageId,
          event.partType,
          event.content,
          event.toolName,
          event.toolInput,
          event.toolOutput,
          sessionState,
          langfuseClient,
          applyRedaction,
          applyObjectRedaction
        );
      } else if (event.type === 'tool.execute.before' || event.type === 'tool.execute.after') {
        yield* handleToolEvent(
          event.sessionId,
          event.type,
          event.toolName,
          event.toolInput,
          event.toolOutput,
          event.error,
          sessionState,
          langfuseClient,
          applyRedaction,
          applyObjectRedaction
        );
      } else if (event.type === 'chat.params') {
        yield* handleChatParamsEvent(event.sessionId, event.params, sessionState);
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logError('Error processing event', {
          eventKey: getEventKey(event),
          cause: String(cause),
        })
      )
    );

  /**
   * Schedule processing for an event after debounce duration.
   */
  const scheduleProcessing = (eventKey: string): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      // Wait for debounce duration
      yield* Effect.sleep(DEBOUNCE_DURATION);

      // Get and remove the event from state
      const state = yield* Ref.get(stateRef);
      const maybeEvent = HashMap.get(state.events, eventKey);

      if (Option.isNone(maybeEvent)) {
        return;
      }

      // Remove from state
      yield* Ref.update(stateRef, (s) => ({
        events: HashMap.remove(s.events, eventKey),
        timers: HashMap.remove(s.timers, eventKey),
      }));

      // Process the event
      yield* processEvent(maybeEvent.value);
    });

  /**
   * Check if an event should be processed immediately (no debounce).
   *
   * - Session events: must be immediate so message events have session state
   * - Message events: must be immediate so message.part events have message info
   * - Chat params: must be immediate so params are stored before generation is created
   * - Only message.part events are debounced (to consolidate streaming text)
   */
  const shouldProcessImmediately = (event: PluginEvent): boolean => {
    return (
      event.type === 'session.created' ||
      event.type === 'session.updated' ||
      event.type === 'session.delete' ||
      event.type === 'message.updated' ||
      event.type === 'chat.params'
    );
  };

  /**
   * Handle an incoming event - update state and reset debounce timer.
   * Session events are processed immediately without debounce.
   */
  const handleIncomingEvent = (event: PluginEvent): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      // Session events must be processed immediately
      if (shouldProcessImmediately(event)) {
        yield* processEvent(event);
        return;
      }

      const eventKey = getEventKey(event);

      // Get current state
      const state = yield* Ref.get(stateRef);

      // Cancel existing timer if any
      const existingTimer = HashMap.get(state.timers, eventKey);
      if (Option.isSome(existingTimer)) {
        yield* Fiber.interrupt(existingTimer.value);
      }

      // Start new timer
      const timerFiber = yield* Effect.fork(scheduleProcessing(eventKey));

      // Update state with new event and timer
      yield* Ref.set(stateRef, {
        events: HashMap.set(state.events, eventKey, event),
        timers: HashMap.set(state.timers, eventKey, timerFiber),
      });
    });

  /**
   * Log when an event is received from the queue.
   */
  const logEventReceived = (event: PluginEvent): Effect.Effect<void, never, never> =>
    Effect.logDebug('Event received', {
      type: event.type,
      eventKey: getEventKey(event),
    });

  /**
   * Create a stream that consumes from the queue and processes events.
   *
   * Pipeline: Queue -> Log -> Handle (with debounce for non-immediate events)
   */
  const processingStream = Stream.fromQueue(eventQueue.queue).pipe(
    Stream.tap(logEventReceived),
    Stream.mapEffect(handleIncomingEvent)
  );

  return processingStream;
});

/**
 * Handle chat.params event - store model parameters for the next generation.
 */
function handleChatParamsEvent(
  sessionId: string,
  params: ModelParams,
  sessionState: SessionState
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const existing = yield* sessionState.get(sessionId);
    if (!existing) {
      yield* Effect.logWarning('No session state for chat.params', { sessionId });
      return;
    }

    // Store params as pending for the next generation
    yield* sessionState.update(sessionId, (state) => ({
      ...state,
      pendingModelParams: params,
    }));

    yield* Effect.logDebug('Stored pending model params', { sessionId, params });
  });
}

/**
 * Handle session.created and session.updated events.
 */
function handleSessionEvent(
  sessionId: string,
  eventType: 'session.created' | 'session.updated',
  title: string | undefined,
  sessionState: SessionState,
  langfuseClient: LangfuseClient,
  applyRedaction: (s: string | undefined) => string | undefined
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const traceId = sessionToUUID(sessionId);

    const existing = yield* sessionState.get(sessionId);

    if (!existing) {
      const traceState: TraceState = {
        traceId,
        sessionId,
        title: title || 'OpenCode Session',
        createdAt: Date.now(),
        messages: new Map(),
        spans: new Map(),
      };
      yield* sessionState.set(sessionId, traceState);

      yield* langfuseClient
        .createTrace({
          id: traceId,
          sessionId,
          name: applyRedaction(traceState.title) || 'OpenCode Session',
        })
        .pipe(Effect.catchAll(() => Effect.void));
    } else if (eventType === 'session.updated' && title && title !== existing.title) {
      // Update local state
      yield* sessionState.update(sessionId, (state) => ({
        ...state,
        title: title,
      }));

      // Update the Langfuse trace with the new title
      yield* langfuseClient
        .createTrace({
          id: traceId,
          sessionId,
          name: applyRedaction(title) || existing.title,
        })
        .pipe(Effect.catchAll(() => Effect.void));
    }
  });
}

/**
 * Handle session.delete event.
 */
function handleSessionDelete(
  sessionId: string,
  sessionState: SessionState,
  langfuseClient: LangfuseClient
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    yield* langfuseClient.flush.pipe(Effect.catchAll(() => Effect.void));
    yield* sessionState.delete(sessionId);
  });
}

/**
 * Handle message.updated events.
 *
 * This registers the message in our state (for later part lookups) and creates
 * the appropriate Langfuse observation (span for user, generation for assistant).
 * The actual content comes from message.part.updated events.
 */
function handleMessageEvent(
  sessionId: string,
  messageId: string,
  role: 'user' | 'assistant',
  model: string | undefined,
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      }
    | undefined,
  parentId: string | undefined,
  cost: number | undefined,
  time: { created: number; completed?: number } | undefined,
  sessionState: SessionState,
  langfuseClient: LangfuseClient
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const state = yield* sessionState.get(sessionId);
    if (!state) {
      yield* Effect.logWarning('No session state for message', { sessionId, messageId });
      return;
    }

    // Check if we already have this message registered
    if (state.messages.has(messageId)) {
      // Already registered, nothing to do
      return;
    }

    // Generate a unique observation ID for this message
    const observationId = `${messageId}-${Date.now()}`;

    // Resolve parent observation ID from parent message ID
    let parentObservationId: string | undefined;
    if (parentId) {
      const parentInfo = state.messages.get(parentId);
      if (parentInfo) {
        parentObservationId = parentInfo.observationId;
      }
    }

    // Create the appropriate Langfuse observation
    if (role === 'user') {
      yield* langfuseClient
        .createSpan({
          id: observationId,
          traceId: state.traceId,
          parentObservationId,
          name: 'user-message',
        })
        .pipe(Effect.catchAll(() => Effect.void));
    } else {
      // Build usageDetails with all token types
      const usageDetails: Record<string, number> = {};
      if (usage) {
        if (usage.promptTokens !== undefined) usageDetails.input = usage.promptTokens;
        if (usage.completionTokens !== undefined) usageDetails.output = usage.completionTokens;
        if (usage.totalTokens !== undefined) usageDetails.total = usage.totalTokens;
        if (usage.reasoningTokens !== undefined && usage.reasoningTokens > 0) {
          usageDetails.reasoning = usage.reasoningTokens;
        }
        if (usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0) {
          usageDetails.cache_read = usage.cacheReadTokens;
        }
        if (usage.cacheWriteTokens !== undefined && usage.cacheWriteTokens > 0) {
          usageDetails.cache_write = usage.cacheWriteTokens;
        }
      }

      // Build costDetails
      const costDetails: Record<string, number> | undefined =
        cost !== undefined && cost > 0 ? { total: cost } : undefined;

      // Convert timestamps to Date objects
      const startTime = time?.created ? new Date(time.created) : undefined;
      const endTime = time?.completed ? new Date(time.completed) : undefined;

      // Build modelParameters from pending params (captured via chat.params hook)
      let modelParameters: Record<string, string | number | boolean | null> | undefined;
      if (state.pendingModelParams) {
        const params = state.pendingModelParams;
        modelParameters = {};
        if (params.temperature !== undefined) modelParameters.temperature = params.temperature;
        if (params.topP !== undefined) modelParameters.top_p = params.topP;
        if (params.topK !== undefined) modelParameters.top_k = params.topK;
        if (params.maxTokens !== undefined) modelParameters.max_tokens = params.maxTokens;
        if (params.frequencyPenalty !== undefined)
          modelParameters.frequency_penalty = params.frequencyPenalty;
        if (params.presencePenalty !== undefined)
          modelParameters.presence_penalty = params.presencePenalty;
        if (params.stop !== undefined && params.stop.length > 0)
          modelParameters.stop = params.stop.join(',');
      }

      yield* langfuseClient
        .createGeneration({
          id: observationId,
          traceId: state.traceId,
          parentObservationId,
          name: 'assistant-response',
          model,
          modelParameters:
            modelParameters && Object.keys(modelParameters).length > 0
              ? modelParameters
              : undefined,
          usageDetails: Object.keys(usageDetails).length > 0 ? usageDetails : undefined,
          costDetails,
          startTime,
          endTime,
        })
        .pipe(Effect.catchAll(() => Effect.void));
    }

    // Register message in state and clear pending model params (they've been consumed)
    const newMessages = new Map(state.messages);
    newMessages.set(messageId, { observationId, role, model, parentObservationId });
    yield* sessionState.update(sessionId, (s) => ({
      ...s,
      messages: newMessages,
      pendingModelParams: undefined, // Clear after consumption
    }));
  });
}

/**
 * Handle message.part.updated events.
 *
 * Uses the messageId to look up the parent observation and attach content appropriately:
 * - For user messages: update the span's input with the text
 * - For assistant messages: update the generation's output with the text
 * - For tool calls: create child spans under the parent message
 */
function handleMessagePartEvent(
  sessionId: string,
  messageId: string,
  partType: 'text' | 'tool-call',
  textContent: string | undefined,
  toolName: string | undefined,
  toolInput: unknown,
  toolOutput: unknown,
  sessionState: SessionState,
  langfuseClient: LangfuseClient,
  applyRedaction: (s: string | undefined) => string | undefined,
  applyObjectRedaction: <T>(obj: T) => T
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const state = yield* sessionState.get(sessionId);
    if (!state) {
      yield* Effect.logWarning('No session state for message part', { sessionId, messageId });
      return;
    }

    // Look up the parent message
    const messageInfo = state.messages.get(messageId);
    if (!messageInfo) {
      yield* Effect.logWarning('No message info for part', { sessionId, messageId, partType });
      return;
    }

    if (partType === 'text' && textContent) {
      // Text content - update the parent observation
      if (messageInfo.role === 'user') {
        // Update user span with input text
        yield* langfuseClient
          .createSpan({
            id: messageInfo.observationId,
            traceId: state.traceId,
            name: 'user-message',
            input: applyRedaction(textContent),
          })
          .pipe(Effect.catchAll(() => Effect.void));
      } else {
        // Update assistant generation with output text
        yield* langfuseClient
          .createGeneration({
            id: messageInfo.observationId,
            traceId: state.traceId,
            name: 'assistant-response',
            output: applyRedaction(textContent),
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }
      return;
    }

    if (partType === 'tool-call') {
      // Tool calls arrive with both input and output when completed
      yield* langfuseClient
        .createSpan({
          traceId: state.traceId,
          parentObservationId: messageInfo.observationId,
          name: `tool-${toolName || 'unknown'}`,
          input: applyObjectRedaction(toolInput),
          output: applyObjectRedaction(toolOutput),
        })
        .pipe(Effect.catchAll(() => Effect.void));
    }
  });
}

/**
 * Handle tool.execute.before and tool.execute.after events.
 */
function handleToolEvent(
  sessionId: string,
  eventType: 'tool.execute.before' | 'tool.execute.after',
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
  error: string | undefined,
  sessionState: SessionState,
  langfuseClient: LangfuseClient,
  applyRedaction: (s: string | undefined) => string | undefined,
  applyObjectRedaction: <T>(obj: T) => T
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const state = yield* sessionState.get(sessionId);
    if (!state) {
      yield* Effect.logWarning('No session state for tool event', { sessionId });
      return;
    }

    if (eventType === 'tool.execute.before') {
      yield* langfuseClient
        .createSpan({
          traceId: state.traceId,
          name: `tool-${toolName}`,
          input: applyObjectRedaction(toolInput),
          startTime: new Date(),
        })
        .pipe(Effect.catchAll(() => Effect.void));
    } else {
      const metadata = error ? { error: applyRedaction(error) || null } : undefined;
      yield* langfuseClient
        .createSpan({
          traceId: state.traceId,
          name: `tool-${toolName}`,
          output: applyObjectRedaction(toolOutput),
          endTime: new Date(),
          metadata,
        })
        .pipe(Effect.catchAll(() => Effect.void));
    }
  });
}

/**
 * Run the event processor stream.
 */
export const runEventProcessor = Effect.gen(function* () {
  const stream = yield* createEventProcessor;
  yield* Effect.logInfo('Starting event processor stream');
  yield* Stream.runDrain(stream);
});

/**
 * Fork the event processor to run in the background.
 */
export const forkEventProcessor = Effect.gen(function* () {
  const stream = yield* createEventProcessor;
  yield* Effect.logInfo('Forking event processor stream');
  const fiber = yield* Stream.runDrain(stream).pipe(Effect.fork);
  return fiber;
});
