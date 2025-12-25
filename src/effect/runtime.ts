/**
 * Effect runtime and layer composition for the Langfuse exporter plugin.
 *
 * This module sets up the Effect runtime with all required services.
 */

import { Effect, Layer, ManagedRuntime } from 'effect';

// Import services (will be implemented in services/)
import { EventQueueLive, type EventQueue } from './services/EventQueue.js';
import { SessionStateLive, type SessionState } from './services/SessionState.js';
import { ProcessedIdsLive, type ProcessedIds } from './services/ProcessedIds.js';
import { LangfuseClientLive, type LangfuseClient } from './services/LangfuseClient.js';
import { PinoLoggerLive } from './services/PinoLogger.js';
import type { LangfuseApiError } from './errors.js';

/**
 * Combined layer with all services required by the plugin.
 *
 * Layer dependency graph:
 *   PinoLoggerLive (no deps)
 *   EventQueueLive (no deps)
 *   SessionStateLive (no deps)
 *   ProcessedIdsLive (no deps)
 *   LangfuseClientLive (depends on PinoLoggerLive)
 */
export const PluginLive = Layer.mergeAll(
  PinoLoggerLive,
  EventQueueLive,
  SessionStateLive,
  ProcessedIdsLive
).pipe(Layer.provideMerge(LangfuseClientLive));

/**
 * Type of the full plugin context (all services).
 */
export type PluginContext = EventQueue | SessionState | ProcessedIds | LangfuseClient;

/**
 * Error type that can occur during plugin initialization.
 */
export type PluginError = LangfuseApiError;

/**
 * Managed runtime for the plugin.
 * Use this to run effects with all services available.
 */
let pluginRuntime: ManagedRuntime.ManagedRuntime<PluginContext, PluginError> | null = null;

/**
 * Initialize the plugin runtime.
 * Must be called before any effects can be run.
 */
export const initializeRuntime = Effect.sync(() => {
  if (pluginRuntime !== null) {
    return pluginRuntime;
  }

  pluginRuntime = ManagedRuntime.make(PluginLive);
  return pluginRuntime;
});

/**
 * Get the current runtime, throwing if not initialized.
 */
export function getRuntime(): ManagedRuntime.ManagedRuntime<PluginContext, PluginError> {
  if (pluginRuntime === null) {
    throw new Error('Plugin runtime not initialized. Call initializeRuntime first.');
  }
  return pluginRuntime;
}

/**
 * Run an effect with the plugin runtime.
 * Returns a Promise for integration with non-Effect code.
 */
export async function runEffect<A, E>(effect: Effect.Effect<A, E, PluginContext>): Promise<A> {
  const runtime = getRuntime();
  return runtime.runPromise(effect);
}

/**
 * Run an effect and discard the result (fire-and-forget).
 * Errors are logged but don't propagate.
 */
export function runEffectFork<A, E>(effect: Effect.Effect<A, E, PluginContext>): void {
  const runtime = getRuntime();
  runtime.runFork(
    effect.pipe(Effect.catchAll((error) => Effect.logError('Effect failed', { error })))
  );
}

/**
 * Shutdown the plugin runtime.
 * Must be called on process exit for graceful cleanup.
 */
export const shutdownRuntime = Effect.promise(async () => {
  if (pluginRuntime !== null) {
    await pluginRuntime.dispose();
    pluginRuntime = null;
  }
});

/**
 * Shutdown the runtime (Promise-based for process exit handlers).
 */
export async function shutdown(): Promise<void> {
  if (pluginRuntime !== null) {
    await pluginRuntime.dispose();
    pluginRuntime = null;
  }
}
