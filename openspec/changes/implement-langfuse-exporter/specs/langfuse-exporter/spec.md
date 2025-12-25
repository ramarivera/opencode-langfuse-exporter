# Specification: OpenCode Langfuse Exporter Plugin

## Overview

An OpenCode plugin that exports session transcripts and telemetry data to Langfuse asynchronously without routing LLM provider calls through a proxy.

## Functional Requirements

### A. Data Capture

The plugin MUST:
- Capture data via OpenCode plugin event hooks (`session.*`, `message.*`, `tool.execute.*`)
- Reconstruct per-session timeline including:
  - Session ID and title/name
  - Messages and message parts (tool calls, text chunks)
  - Metadata: timestamps, model/provider, token/cost estimates

### B. Export Format (Langfuse Mapping)

| OpenCode Concept   | Langfuse Concept                           |
| ------------------ | ------------------------------------------ |
| Session            | Trace with `sessionId` parameter           |
| Session ID         | `sessionId` (deterministic, stable)        |
| Session Title      | Trace `name`                               |
| User Message       | `span()` with name="user-message"          |
| Assistant Response | `generation()` with model, input/output, usage |
| Tool Call          | `span()` with name="tool-{toolName}"       |

The plugin MUST:
- Use Langfuse TypeScript SDK for async export
- Use SDK's built-in batching and flush mechanisms
- Authenticate via `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`

### C. Reliability / Buffering

The plugin MUST:
- Never block OpenCode UX (non-blocking, async)
- Use `Queue.bounded(1000)` for backpressure (block producer if queue full)
- Use `Effect.retry` with exponential backoff for transient failures
- Give up after 5 retry attempts and log error (don't block forever)
- Call graceful shutdown on process exit to flush pending events
- Optionally write to disk-based audit log for debugging

When Langfuse is unavailable:
- Retry with exponential backoff (1s base, 30s max, 5 attempts)
- After max retries, log error and discard event
- OpenCode continues unaffected

### C.1 Streaming Event Handling (Effect.ts)

The plugin MUST handle OpenCode's streaming event pattern:
- `message.part.updated` fires on EVERY streaming chunk
- `message.updated` fires multiple times per message

Solution using Effect.ts:
- **Debounce**: 10 seconds per event key (partId/messageId)
- **Grouping**: `Stream.groupByKey` to isolate debounce timers
- **Deduplication**: Track processed IDs in `Ref<HashSet<string>>`
- **Only emit final state**: After 10s of no updates for a given key

### D. Privacy Controls

The plugin MUST support:
- Include/exclude raw prompts/responses via `OPENCODE_LANGFUSE_EXPORT_MODE`
- Redact secrets via regex patterns (`OPENCODE_LANGFUSE_REDACT_REGEX`)
- "Metadata only" mode (trace structure without content)

## Configuration

### Environment Variables (Primary)

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `LANGFUSE_PUBLIC_KEY` | Yes | - | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | Yes | - | Langfuse secret key |
| `LANGFUSE_HOST` | No | https://cloud.langfuse.com | Langfuse server URL |
| `OPENCODE_LANGFUSE_EXPORT_MODE` | No | full | `full`, `metadata_only`, or `off` |
| `OPENCODE_LANGFUSE_REDACT_REGEX` | No | - | Comma-separated regex patterns |
| `OPENCODE_LANGFUSE_VERBOSE` | No | false | Enable verbose logging |
| `OPENCODE_LANGFUSE_ENABLED` | No | true | Enable/disable plugin |

### Plugin Config (opencode.json)

```json
{
  "plugin": {
    "opencode-langfuse-exporter": {
      "enabled": true,
      "flushInterval": 5000,
      "spoolDir": "~/.opencode/langfuse-spool",
      "traceNamePrefix": "opencode-"
    }
  }
}
```

## UX / CLI Behavior

- Quiet by default; verbose mode for debugging
- Status logging: "export queued", "export success", "export failed (will retry)"
- Graceful shutdown with pending event flush

## Non-Functional Requirements

- TypeScript strict mode
- ESLint + Prettier enforced
- Unit tests for core logic (Effect + TestClock for debounce tests)
- No blocking of OpenCode operations
- Effect.ts for streaming, concurrency, and error handling

### Effect.ts Architecture

```
src/effect/
├── runtime.ts           # Effect runtime & layer composition
├── constants.ts         # Configuration constants
├── errors.ts            # Custom Effect errors
├── services/
│   ├── EventQueue.ts    # Queue.bounded(1000)
│   ├── SessionState.ts  # Ref<Map<sessionId, TraceState>>
│   ├── ProcessedIds.ts  # Ref<HashSet<string>>
│   ├── LangfuseClient.ts# Langfuse SDK with retry
│   └── PinoLogger.ts    # Effect Logger → Pino
├── streams/
│   ├── EventProcessor.ts# Main pipeline with debounce
│   └── types.ts         # Stream event types
└── handlers/
    ├── SessionHandler.ts
    ├── MessageHandler.ts
    └── ToolHandler.ts
```

### Key Effect Patterns

```typescript
// Debounce per event key
Stream.fromQueue(eventQueue).pipe(
  Stream.groupByKey((event) => getEventKey(event)),
  Stream.flatMapGrouped((key, events) =>
    events.pipe(Stream.debounce("10 seconds"))
  )
)

// Retry with exponential backoff
const retrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.upTo("30 seconds"),
  Schedule.compose(Schedule.recurs(5))
)

// Pino-backed Effect Logger
const PinoLogger = Logger.make(({ logLevel, message }) => {
  pinoInstance[logLevel.label.toLowerCase()](String(message))
})
```

## Acceptance Criteria

1. Provider calls succeed even if `LANGFUSE_HOST` is unreachable
2. Traces appear in Langfuse grouped under one Session ID
3. Each generation shows model, input/output, token usage
4. Tool calls appear as spans within the trace
5. **Observation count is reasonable** (~10-20, NOT 440 duplicates)
6. **Streaming chunks are consolidated** via 10s debounce
7. **Deduplication works** - no duplicate observations for same event
8. **Retry then give up** - After 5 failed attempts, log and move on
