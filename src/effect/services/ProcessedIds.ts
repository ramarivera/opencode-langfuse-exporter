/**
 * ProcessedIds service - tracks processed event IDs for deduplication.
 *
 * Uses Ref<HashSet> for efficient membership testing.
 */

import { Context, Effect, HashSet, Layer, Ref } from 'effect';

/**
 * ProcessedIds service interface.
 */
export interface ProcessedIds {
  /**
   * Check if an ID has already been processed.
   */
  readonly has: (id: string) => Effect.Effect<boolean>;

  /**
   * Mark an ID as processed.
   * Returns true if the ID was newly added, false if it already existed.
   */
  readonly add: (id: string) => Effect.Effect<boolean>;

  /**
   * Remove an ID from the processed set.
   */
  readonly remove: (id: string) => Effect.Effect<void>;

  /**
   * Get the current count of processed IDs.
   */
  readonly size: Effect.Effect<number>;

  /**
   * Clear all processed IDs.
   */
  readonly clear: Effect.Effect<void>;
}

/**
 * ProcessedIds service tag for dependency injection.
 */
export const ProcessedIds = Context.GenericTag<ProcessedIds>('ProcessedIds');

/**
 * Live implementation of ProcessedIds using Ref<HashSet>.
 */
export const ProcessedIdsLive = Layer.effect(
  ProcessedIds,
  Effect.gen(function* () {
    const setRef = yield* Ref.make<HashSet.HashSet<string>>(HashSet.empty());

    return ProcessedIds.of({
      has: (id) => Ref.get(setRef).pipe(Effect.map((set) => HashSet.has(set, id))),

      add: (id) =>
        Ref.modify(setRef, (set) => {
          if (HashSet.has(set, id)) {
            return [false, set];
          }
          return [true, HashSet.add(set, id)];
        }),

      remove: (id) => Ref.update(setRef, (set) => HashSet.remove(set, id)),

      size: Ref.get(setRef).pipe(Effect.map((set) => HashSet.size(set))),

      clear: Ref.set(setRef, HashSet.empty()),
    });
  })
);
