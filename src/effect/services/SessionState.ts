/**
 * SessionState service - tracks active traces and their state.
 *
 * Uses Ref<Map> for thread-safe mutable state.
 */

import { Context, Effect, Layer, Ref } from 'effect';

import type { TraceState } from '../streams/types.js';

/**
 * SessionState service interface.
 */
export interface SessionState {
  /**
   * Get the state for a session, if it exists.
   */
  readonly get: (sessionId: string) => Effect.Effect<TraceState | undefined>;

  /**
   * Set the state for a session.
   */
  readonly set: (sessionId: string, state: TraceState) => Effect.Effect<void>;

  /**
   * Update the state for a session.
   * Returns the updated state, or undefined if the session doesn't exist.
   */
  readonly update: (
    sessionId: string,
    fn: (state: TraceState) => TraceState
  ) => Effect.Effect<TraceState | undefined>;

  /**
   * Delete a session's state.
   */
  readonly delete: (sessionId: string) => Effect.Effect<void>;

  /**
   * Check if a session exists.
   */
  readonly has: (sessionId: string) => Effect.Effect<boolean>;

  /**
   * Get all active sessions.
   */
  readonly getAll: Effect.Effect<ReadonlyMap<string, TraceState>>;

  /**
   * Clear all session state.
   */
  readonly clear: Effect.Effect<void>;
}

/**
 * SessionState service tag for dependency injection.
 */
export const SessionState = Context.GenericTag<SessionState>('SessionState');

/**
 * Live implementation of SessionState using Ref<Map>.
 */
export const SessionStateLive = Layer.effect(
  SessionState,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<Map<string, TraceState>>(new Map());

    return SessionState.of({
      get: (sessionId) => Ref.get(stateRef).pipe(Effect.map((map) => map.get(sessionId))),

      set: (sessionId, state) =>
        Ref.update(stateRef, (map) => {
          const newMap = new Map(map);
          newMap.set(sessionId, state);
          return newMap;
        }),

      update: (sessionId, fn) =>
        Ref.modify(stateRef, (map) => {
          const existing = map.get(sessionId);
          if (existing === undefined) {
            return [undefined, map];
          }
          const updated = fn(existing);
          const newMap = new Map(map);
          newMap.set(sessionId, updated);
          return [updated, newMap];
        }),

      delete: (sessionId) =>
        Ref.update(stateRef, (map) => {
          const newMap = new Map(map);
          newMap.delete(sessionId);
          return newMap;
        }),

      has: (sessionId) => Ref.get(stateRef).pipe(Effect.map((map) => map.has(sessionId))),

      getAll: Ref.get(stateRef),

      clear: Ref.set(stateRef, new Map()),
    });
  })
);
