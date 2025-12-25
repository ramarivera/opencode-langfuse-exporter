/**
 * OpenCode Langfuse Exporter Plugin
 *
 * Exports OpenCode session transcripts and telemetry data to Langfuse asynchronously.
 * This is an exporter-only plugin - LLM provider calls stay direct (no proxy routing).
 *
 * Features:
 * - Effect.ts-based streaming with debounce for proper event consolidation
 * - Never throws uncaught exceptions
 * - Logs to ~/.opencode/langfuse-exporter/logs/
 * - Resilient to Langfuse downtime (retries with backoff)
 *
 * @see https://langfuse.com/docs/tracing
 * @see https://opencode.ai/docs/plugins/
 */

import type { Plugin } from '@opencode-ai/plugin';
import { Effect, Fiber } from 'effect';

import { getInvalidPatterns, loadConfig, validateConfig } from './lib/config.js';
import { logError, logInfo, logWarn } from './lib/logger.js';
import { forkDaemon, initializeRuntime, runEffect, shutdown } from './effect/runtime.js';
import { EventQueue } from './effect/services/EventQueue.js';
import { runEventProcessor } from './effect/streams/EventProcessor.js';
import type {
  MessageEvent,
  MessagePartEvent,
  PluginEvent,
  SessionEvent,
  ToolEvent,
} from './effect/streams/types.js';

// ============================================================
// TYPE DEFINITIONS
// OpenCode event types (subset needed for this plugin)
// ============================================================

interface Session {
  id: string;
  title: string;
  time: {
    created: number;
    updated: number;
  };
}

interface AssistantMessage {
  id: string;
  sessionID: string;
  role: 'assistant';
  parentID: string;
  modelID: string;
  providerID: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  time: {
    created: number;
    completed?: number;
  };
}

interface UserMessage {
  id: string;
  sessionID: string;
  role: 'user';
  time: { created: number };
}

type Message = UserMessage | AssistantMessage;

interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text';
  text: string;
  time?: { start: number; end?: number };
}

interface ToolPartState {
  status: 'pending' | 'running' | 'completed' | 'error';
  input: object;
  output?: string;
  title?: string;
  time?: { start: number; end?: number };
  error?: string;
}

interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolPartState;
}

type Part = TextPart | ToolPart | { type: string; [key: string]: unknown };

interface Event {
  type: string;
  properties: Record<string, unknown>;
}

// ============================================================
// EVENT CONVERSION
// Convert OpenCode events to our Effect stream types
// ============================================================

function convertSessionEvent(
  eventType: 'session.created' | 'session.updated' | 'session.delete',
  session: Session
): SessionEvent {
  return {
    type: eventType,
    eventKey: session.id,
    timestamp: Date.now(),
    sessionId: session.id,
    title: session.title,
  };
}

function convertMessageEvent(message: Message): MessageEvent | null {
  // Only process complete messages
  if (message.role === 'assistant') {
    const assistantMsg = message as AssistantMessage;
    if (!assistantMsg.time.completed) {
      return null; // Skip incomplete assistant messages
    }

    return {
      type: 'message.updated',
      eventKey: message.id,
      timestamp: Date.now(),
      sessionId: message.sessionID,
      messageId: message.id,
      role: 'assistant',
      model: `${assistantMsg.providerID}/${assistantMsg.modelID}`,
      usage: {
        promptTokens: assistantMsg.tokens.input,
        completionTokens: assistantMsg.tokens.output,
        totalTokens:
          assistantMsg.tokens.input + assistantMsg.tokens.output + assistantMsg.tokens.reasoning,
      },
    };
  }

  // User messages are always complete
  return {
    type: 'message.updated',
    eventKey: message.id,
    timestamp: Date.now(),
    sessionId: message.sessionID,
    messageId: message.id,
    role: 'user',
  };
}

function convertMessagePartEvent(part: Part): MessagePartEvent | null {
  if (part.type === 'text') {
    const textPart = part as TextPart;

    // Only process completed text parts
    if (!textPart.time?.end || !textPart.text) {
      return null;
    }

    return {
      type: 'message.part.updated',
      eventKey: textPart.id,
      timestamp: Date.now(),
      sessionId: textPart.sessionID,
      messageId: textPart.messageID,
      partId: textPart.id,
      partType: 'text',
      content: textPart.text,
    };
  }

  if (part.type === 'tool') {
    const toolPart = part as ToolPart;

    // Only process completed or errored tool calls
    if (toolPart.state.status !== 'completed' && toolPart.state.status !== 'error') {
      return null;
    }

    return {
      type: 'message.part.updated',
      eventKey: toolPart.id,
      timestamp: Date.now(),
      sessionId: toolPart.sessionID,
      messageId: toolPart.messageID,
      partId: toolPart.id,
      partType: toolPart.state.status === 'error' ? 'tool-result' : 'tool-invocation',
      toolName: toolPart.tool,
      toolInput: toolPart.state.input,
      toolOutput: toolPart.state.output,
    };
  }

  return null;
}

function convertToolEvent(
  eventType: 'tool.execute.before' | 'tool.execute.after',
  tool: string,
  sessionId: string,
  input?: unknown,
  output?: unknown,
  error?: string
): ToolEvent {
  return {
    type: eventType,
    eventKey: `${sessionId}:${tool}:${Date.now()}`,
    timestamp: Date.now(),
    sessionId,
    toolName: tool,
    toolInput: input,
    toolOutput: output,
    error,
  };
}

// ============================================================
// PLUGIN STATE
// ============================================================

let isInitialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processorFiber: Fiber.RuntimeFiber<void, any> | null = null;

// ============================================================
// PLUGIN EXPORT
// ============================================================

export const LangfuseExporterPlugin: Plugin = async () => {
  try {
    // Load and validate configuration
    const pluginConfig = loadConfig();
    const errors = validateConfig(pluginConfig);

    // Log any invalid redact patterns
    const invalidPatterns = getInvalidPatterns();
    for (const pattern of invalidPatterns) {
      logWarn(`Invalid redact pattern ignored: ${pattern}`);
    }

    if (errors.length > 0) {
      for (const error of errors) {
        logError(new Error(error), 'Configuration error');
      }
      logWarn('Plugin disabled due to configuration errors');
      return {};
    }

    if (!pluginConfig.enabled) {
      logInfo('Plugin disabled via configuration');
      return {};
    }

    if (pluginConfig.exportMode === 'off') {
      logInfo('Export mode is off, plugin inactive');
      return {};
    }

    // Initialize Effect runtime
    // Note: Must use Effect.runPromise directly here, not runEffect,
    // because runEffect requires the runtime to exist first (chicken-and-egg).
    try {
      await Effect.runPromise(initializeRuntime);
      isInitialized = true;
      logInfo('Effect runtime initialized');

      // Fork the event processor as a daemon fiber.
      // IMPORTANT: Must use forkDaemon (runtime.runFork) instead of
      // runEffect(Effect.fork(...)) because we need a true daemon fiber
      // that persists across multiple runPromise calls. Otherwise, the
      // stream fiber's parent context terminates when runPromise completes,
      // preventing it from receiving queue events offered later.
      processorFiber = forkDaemon(runEventProcessor);
      logInfo('Event processor started');
    } catch (error) {
      logError(error, 'Failed to initialize Effect runtime');
      return {};
    }

    // Register shutdown handler
    const shutdownHandler = async (): Promise<void> => {
      try {
        logInfo('Shutting down Langfuse exporter...');

        // Interrupt the processor fiber
        if (processorFiber) {
          await runEffect(Fiber.interrupt(processorFiber));
          processorFiber = null;
        }

        // Shutdown the runtime
        await shutdown();
        logInfo('Langfuse exporter shutdown complete');
      } catch (error) {
        logError(error, 'Error during shutdown');
      }
    };

    process.on('beforeExit', shutdownHandler);
    process.on('SIGINT', async () => {
      await shutdownHandler();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await shutdownHandler();
      process.exit(0);
    });

    /**
     * Queue an event for processing.
     * This is non-blocking - events are processed asynchronously with debounce.
     */
    const queueEvent = async (event: PluginEvent): Promise<void> => {
      if (!isInitialized) return;

      try {
        await runEffect(
          Effect.gen(function* () {
            const queue = yield* EventQueue;
            yield* queue.offer(event);
          })
        );
      } catch (error) {
        logError(error, 'Failed to queue event');
      }
    };

    return {
      // Main event hook - handles all OpenCode events
      async event({ event }: { event: Event }): Promise<void> {
        if (!isInitialized) return;

        try {
          switch (event.type) {
            case 'session.created': {
              const session = (event.properties as { info: Session }).info;
              await queueEvent(convertSessionEvent('session.created', session));
              break;
            }

            case 'session.updated': {
              const session = (event.properties as { info: Session }).info;
              await queueEvent(convertSessionEvent('session.updated', session));
              break;
            }

            case 'session.delete': {
              const session = (event.properties as { info: Session }).info;
              await queueEvent(convertSessionEvent('session.delete', session));
              break;
            }

            case 'message.updated': {
              const message = (event.properties as { info: Message }).info;
              const converted = convertMessageEvent(message);
              if (converted) {
                await queueEvent(converted);
              }
              break;
            }

            case 'message.part.updated': {
              const part = (event.properties as { part: Part }).part;
              const converted = convertMessagePartEvent(part);
              if (converted) {
                await queueEvent(converted);
              }
              break;
            }

            // Silently ignore other events
            default:
              break;
          }
        } catch (error) {
          logError(error, `Error handling event ${event.type}`);
        }
      },

      // Tool execution hooks for more precise timing
      async 'tool.execute.before'(
        input: { tool: string; sessionID: string; callID: string },
        _output: { args: unknown }
      ): Promise<void> {
        if (!isInitialized) return;

        await queueEvent(
          convertToolEvent('tool.execute.before', input.tool, input.sessionID, _output.args)
        );
      },

      async 'tool.execute.after'(
        input: { tool: string; sessionID: string; callID: string },
        output: { title: string; output: string; metadata: unknown }
      ): Promise<void> {
        if (!isInitialized) return;

        await queueEvent(
          convertToolEvent(
            'tool.execute.after',
            input.tool,
            input.sessionID,
            undefined,
            output.output
          )
        );
      },
    };
  } catch (error) {
    logError(error, 'Fatal error initializing plugin');
    return {};
  }
};

// Default export for OpenCode plugin loader
export default LangfuseExporterPlugin;
