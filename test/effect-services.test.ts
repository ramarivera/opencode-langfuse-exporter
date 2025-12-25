/**
 * Unit tests for Effect.ts services.
 *
 * Tests the core Effect services: EventQueue, SessionState, ProcessedIds.
 * Uses Effect's testing patterns with Layer-based dependency injection.
 */

import { Effect, Exit, Layer, Queue } from 'effect';
import { describe, expect, it } from 'vitest';

import { EventQueue, EventQueueLive, EventQueueTest } from '../src/effect/services/EventQueue';
import { ProcessedIds, ProcessedIdsLive } from '../src/effect/services/ProcessedIds';
import { SessionState, SessionStateLive } from '../src/effect/services/SessionState';
import type { MessageEvent, SessionEvent, TraceState } from '../src/effect/streams/types';

// Helper to run Effect tests with a layer
const runWithLayer = <A, E>(
  effect: Effect.Effect<A, E, EventQueue>,
  layer: Layer.Layer<EventQueue>
) => Effect.runPromise(Effect.provide(effect, layer));

// Helper to run Effect tests with the live layer
const runWithProcessedIds = <A, E>(effect: Effect.Effect<A, E, ProcessedIds>) =>
  Effect.runPromise(Effect.provide(effect, ProcessedIdsLive));

const runWithSessionState = <A, E>(effect: Effect.Effect<A, E, SessionState>) =>
  Effect.runPromise(Effect.provide(effect, SessionStateLive));

// Test fixtures
const createSessionEvent = (sessionId: string): SessionEvent => ({
  type: 'session.created',
  eventKey: sessionId,
  timestamp: Date.now(),
  sessionId,
  title: 'Test Session',
});

const _createMessageEvent = (sessionId: string, messageId: string): MessageEvent => ({
  type: 'message.updated',
  eventKey: messageId,
  timestamp: Date.now(),
  sessionId,
  messageId,
  role: 'assistant',
  model: 'gpt-4',
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
});

const createTraceState = (sessionId: string): TraceState => ({
  traceId: `trace-${sessionId}`,
  sessionId,
  title: 'Test Trace',
  createdAt: Date.now(),
  messages: new Map(),
  spans: new Map(),
});

describe('EventQueue Service', () => {
  describe('with EventQueueLive', () => {
    it('should offer and take events', async () => {
      const result = await runWithLayer(
        Effect.gen(function* () {
          const queue = yield* EventQueue;
          const event = createSessionEvent('session-1');

          const offered = yield* queue.offer(event);
          expect(offered).toBe(true);

          const taken = yield* queue.take;
          expect(taken).toEqual(event);

          return true;
        }),
        EventQueueLive
      );

      expect(result).toBe(true);
    });

    it('should maintain FIFO order', async () => {
      const result = await runWithLayer(
        Effect.gen(function* () {
          const queue = yield* EventQueue;

          const event1 = createSessionEvent('session-1');
          const event2 = createSessionEvent('session-2');
          const event3 = createSessionEvent('session-3');

          yield* queue.offer(event1);
          yield* queue.offer(event2);
          yield* queue.offer(event3);

          const taken1 = yield* queue.take;
          const taken2 = yield* queue.take;
          const taken3 = yield* queue.take;

          expect(taken1.sessionId).toBe('session-1');
          expect(taken2.sessionId).toBe('session-2');
          expect(taken3.sessionId).toBe('session-3');

          return true;
        }),
        EventQueueLive
      );

      expect(result).toBe(true);
    });

    it('should expose underlying queue for stream consumption', async () => {
      const result = await runWithLayer(
        Effect.gen(function* () {
          const eventQueue = yield* EventQueue;

          // Queue should be accessible
          expect(eventQueue.queue).toBeDefined();

          // Should be able to check size via Queue API
          const size = yield* Queue.size(eventQueue.queue);
          expect(size).toBe(0);

          return true;
        }),
        EventQueueLive
      );

      expect(result).toBe(true);
    });
  });

  describe('with EventQueueTest', () => {
    it('should work with custom capacity', async () => {
      const smallCapacity = 2;
      const result = await runWithLayer(
        Effect.gen(function* () {
          const queue = yield* EventQueue;

          // Should accept events up to capacity
          yield* queue.offer(createSessionEvent('s1'));
          yield* queue.offer(createSessionEvent('s2'));

          const size = yield* Queue.size(queue.queue);
          expect(size).toBe(2);

          return true;
        }),
        EventQueueTest(smallCapacity)
      );

      expect(result).toBe(true);
    });
  });
});

describe('ProcessedIds Service', () => {
  it('should track processed IDs', async () => {
    const result = await runWithProcessedIds(
      Effect.gen(function* () {
        const processedIds = yield* ProcessedIds;

        // Initially empty
        const hasInitial = yield* processedIds.has('id-1');
        expect(hasInitial).toBe(false);

        // Add returns true for new ID
        const added = yield* processedIds.add('id-1');
        expect(added).toBe(true);

        // Now has the ID
        const hasAfterAdd = yield* processedIds.has('id-1');
        expect(hasAfterAdd).toBe(true);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should return false when adding duplicate ID', async () => {
    const result = await runWithProcessedIds(
      Effect.gen(function* () {
        const processedIds = yield* ProcessedIds;

        const first = yield* processedIds.add('dup-id');
        expect(first).toBe(true);

        const second = yield* processedIds.add('dup-id');
        expect(second).toBe(false);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should track size correctly', async () => {
    const result = await runWithProcessedIds(
      Effect.gen(function* () {
        const processedIds = yield* ProcessedIds;

        const size0 = yield* processedIds.size;
        expect(size0).toBe(0);

        yield* processedIds.add('a');
        yield* processedIds.add('b');
        yield* processedIds.add('c');

        const size3 = yield* processedIds.size;
        expect(size3).toBe(3);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should support remove operation', async () => {
    const result = await runWithProcessedIds(
      Effect.gen(function* () {
        const processedIds = yield* ProcessedIds;

        yield* processedIds.add('to-remove');
        const hasBefore = yield* processedIds.has('to-remove');
        expect(hasBefore).toBe(true);

        yield* processedIds.remove('to-remove');
        const hasAfter = yield* processedIds.has('to-remove');
        expect(hasAfter).toBe(false);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should support clear operation', async () => {
    const result = await runWithProcessedIds(
      Effect.gen(function* () {
        const processedIds = yield* ProcessedIds;

        yield* processedIds.add('x');
        yield* processedIds.add('y');
        yield* processedIds.add('z');

        const sizeBefore = yield* processedIds.size;
        expect(sizeBefore).toBe(3);

        yield* processedIds.clear;

        const sizeAfter = yield* processedIds.size;
        expect(sizeAfter).toBe(0);

        return true;
      })
    );

    expect(result).toBe(true);
  });
});

describe('SessionState Service', () => {
  it('should store and retrieve session state', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;
        const state = createTraceState('session-1');

        yield* sessionState.set('session-1', state);

        const retrieved = yield* sessionState.get('session-1');
        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe('session-1');
        expect(retrieved?.traceId).toBe('trace-session-1');

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should return undefined for missing session', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;

        const missing = yield* sessionState.get('nonexistent');
        expect(missing).toBeUndefined();

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should update existing session state', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;
        const initialState = createTraceState('session-1');

        yield* sessionState.set('session-1', initialState);

        const updated = yield* sessionState.update('session-1', (state) => ({
          ...state,
          title: 'Updated Title',
        }));

        expect(updated?.title).toBe('Updated Title');

        const retrieved = yield* sessionState.get('session-1');
        expect(retrieved?.title).toBe('Updated Title');

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should return undefined when updating nonexistent session', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;

        const updated = yield* sessionState.update('nonexistent', (state) => ({
          ...state,
          title: 'New Title',
        }));

        expect(updated).toBeUndefined();

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should delete session state', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;
        const state = createTraceState('to-delete');

        yield* sessionState.set('to-delete', state);
        const hasBefore = yield* sessionState.has('to-delete');
        expect(hasBefore).toBe(true);

        yield* sessionState.delete('to-delete');
        const hasAfter = yield* sessionState.has('to-delete');
        expect(hasAfter).toBe(false);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should get all sessions', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;

        yield* sessionState.set('s1', createTraceState('s1'));
        yield* sessionState.set('s2', createTraceState('s2'));
        yield* sessionState.set('s3', createTraceState('s3'));

        const all = yield* sessionState.getAll;
        expect(all.size).toBe(3);
        expect(all.has('s1')).toBe(true);
        expect(all.has('s2')).toBe(true);
        expect(all.has('s3')).toBe(true);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should clear all sessions', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;

        yield* sessionState.set('s1', createTraceState('s1'));
        yield* sessionState.set('s2', createTraceState('s2'));

        yield* sessionState.clear;

        const all = yield* sessionState.getAll;
        expect(all.size).toBe(0);

        return true;
      })
    );

    expect(result).toBe(true);
  });

  it('should track messages within session state', async () => {
    const result = await runWithSessionState(
      Effect.gen(function* () {
        const sessionState = yield* SessionState;
        const state = createTraceState('session-with-messages');

        yield* sessionState.set('session-with-messages', state);

        // Simulate adding a message
        yield* sessionState.update('session-with-messages', (s) => {
          const newMessages = new Map(s.messages);
          newMessages.set('msg-1', {
            observationId: 'obs-1',
            role: 'assistant',
            model: 'gpt-4',
          });
          return { ...s, messages: newMessages };
        });

        const retrieved = yield* sessionState.get('session-with-messages');
        expect(retrieved?.messages.size).toBe(1);
        expect(retrieved?.messages.get('msg-1')?.model).toBe('gpt-4');

        return true;
      })
    );

    expect(result).toBe(true);
  });
});

describe('Service Layer Composition', () => {
  it('should compose multiple services in a single layer', async () => {
    const composedLayer = Layer.mergeAll(EventQueueLive, ProcessedIdsLive, SessionStateLive);

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const eventQueue = yield* EventQueue;
          const processedIds = yield* ProcessedIds;
          const sessionState = yield* SessionState;

          // All services should be available
          expect(eventQueue).toBeDefined();
          expect(processedIds).toBeDefined();
          expect(sessionState).toBeDefined();

          // They should work together
          const event = createSessionEvent('composed-test');
          yield* eventQueue.offer(event);
          yield* processedIds.add(event.eventKey);
          yield* sessionState.set(event.sessionId, createTraceState(event.sessionId));

          const hasId = yield* processedIds.has(event.eventKey);
          const hasSession = yield* sessionState.has(event.sessionId);

          expect(hasId).toBe(true);
          expect(hasSession).toBe(true);

          return true;
        }),
        composedLayer
      )
    );

    expect(result).toBe(true);
  });
});

describe('Effect Exit patterns', () => {
  it('should handle success exit', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        Effect.gen(function* () {
          const processedIds = yield* ProcessedIds;
          return yield* processedIds.add('success-test');
        }),
        ProcessedIdsLive
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(true);
    }
  });
});
