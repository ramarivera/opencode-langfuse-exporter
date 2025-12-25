/**
 * Stream event types for the Effect-based event processor.
 *
 * These types represent the events flowing through the stream pipeline.
 */

/**
 * Base interface for all plugin events.
 */
export interface BasePluginEvent {
  /** Unique key for grouping/deduplication (partId, messageId, or sessionId) */
  readonly eventKey: string;
  /** Timestamp when the event was received */
  readonly timestamp: number;
  /** Session this event belongs to */
  readonly sessionId: string;
}

/**
 * Session lifecycle events.
 */
export interface SessionEvent extends BasePluginEvent {
  readonly type: 'session.created' | 'session.updated' | 'session.delete';
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Message events (user messages and assistant responses).
 */
export interface MessageEvent extends BasePluginEvent {
  readonly type: 'message.updated';
  readonly messageId: string;
  readonly role: 'user' | 'assistant';
  readonly content?: string;
  readonly model?: string;
  /** Parent message ID for conversation threading */
  readonly parentId?: string;
  /** Cost in USD */
  readonly cost?: number;
  /** Timing information */
  readonly time?: {
    readonly created: number;
    readonly completed?: number;
  };
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
    /** Reasoning tokens (for o1, etc.) */
    readonly reasoningTokens?: number;
    /** Cache tokens */
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  };
}

/**
 * Message part events (text chunks, tool calls).
 */
export interface MessagePartEvent extends BasePluginEvent {
  readonly type: 'message.part.updated';
  readonly messageId: string;
  readonly partId: string;
  readonly partType: 'text' | 'tool-call';
  readonly content?: string;
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly toolOutput?: unknown;
  readonly toolError?: string;
}

/**
 * Tool execution events (from tool hooks).
 */
export interface ToolEvent extends BasePluginEvent {
  readonly type: 'tool.execute.before' | 'tool.execute.after';
  readonly toolName: string;
  readonly toolInput?: unknown;
  readonly toolOutput?: unknown;
  readonly duration?: number;
  readonly error?: string;
}

/**
 * Union type of all events that flow through the stream.
 */
export type PluginEvent = SessionEvent | MessageEvent | MessagePartEvent | ToolEvent;

/**
 * Extract the event key used for grouping and deduplication.
 *
 * - For parts: use partId (most granular)
 * - For messages: use messageId
 * - For sessions: use sessionId
 * - For tools: use sessionId + toolName (unique per invocation)
 */
export function getEventKey(event: PluginEvent): string {
  switch (event.type) {
    case 'message.part.updated':
      return event.partId;
    case 'message.updated':
      return event.messageId;
    case 'tool.execute.before':
    case 'tool.execute.after':
      return `${event.sessionId}:${event.toolName}:${event.timestamp}`;
    default:
      return event.sessionId;
  }
}

/**
 * Info about a message we're tracking.
 */
export interface MessageInfo {
  /** Langfuse observation ID for this message */
  readonly observationId: string;
  /** Role of the message sender */
  readonly role: 'user' | 'assistant';
  /** Model used (for assistant messages) */
  readonly model?: string;
  /** Parent observation ID for threading (from previous message) */
  readonly parentObservationId?: string;
}

/**
 * State tracked for an active trace (session).
 */
export interface TraceState {
  /** Langfuse trace ID */
  readonly traceId: string;
  /** Session ID from OpenCode */
  readonly sessionId: string;
  /** Session title/name */
  readonly title: string;
  /** When the trace was created */
  readonly createdAt: number;
  /** Message info (messageId -> MessageInfo) - tracks role and Langfuse observation ID */
  readonly messages: Map<string, MessageInfo>;
  /** Active span IDs (partId/toolKey -> spanId) */
  readonly spans: Map<string, string>;
}
