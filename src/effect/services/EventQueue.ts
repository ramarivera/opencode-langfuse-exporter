/**
 * EventQueue service - bounded queue for incoming OpenCode events.
 *
 * Uses Queue.bounded for backpressure: producers block when queue is full.
 */

import { Context, Effect, Layer, Queue } from 'effect';

import { QUEUE_CAPACITY } from '../constants.js';
import type { PluginEvent } from '../streams/types.js';

/**
 * EventQueue service interface.
 */
export interface EventQueue {
  /**
   * Offer an event to the queue.
   * Blocks if the queue is at capacity (backpressure).
   */
  readonly offer: (event: PluginEvent) => Effect.Effect<boolean>;

  /**
   * Take an event from the queue.
   * Blocks if the queue is empty.
   */
  readonly take: Effect.Effect<PluginEvent>;

  /**
   * Get the underlying queue for stream consumption.
   */
  readonly queue: Queue.Queue<PluginEvent>;

  /**
   * Shutdown the queue, signaling no more events will be offered.
   */
  readonly shutdown: Effect.Effect<void>;
}

/**
 * EventQueue service tag for dependency injection.
 */
export const EventQueue = Context.GenericTag<EventQueue>('EventQueue');

/**
 * Live implementation of EventQueue using Queue.bounded.
 */
export const EventQueueLive = Layer.effect(
  EventQueue,
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<PluginEvent>(QUEUE_CAPACITY);

    return EventQueue.of({
      offer: (event) => Queue.offer(queue, event),
      take: Queue.take(queue),
      queue,
      shutdown: Queue.shutdown(queue),
    });
  })
);

/**
 * Test implementation with a smaller queue for unit tests.
 */
export const EventQueueTest = (capacity: number = 10) =>
  Layer.effect(
    EventQueue,
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<PluginEvent>(capacity);

      return EventQueue.of({
        offer: (event) => Queue.offer(queue, event),
        take: Queue.take(queue),
        queue,
        shutdown: Queue.shutdown(queue),
      });
    })
  );
