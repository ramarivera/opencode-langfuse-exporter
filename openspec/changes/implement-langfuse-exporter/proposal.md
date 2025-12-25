# Change: Implement OpenCode Langfuse Exporter Plugin

## Why

OpenCode users need observability into their AI coding sessions without disrupting the direct LLM provider connections. While Helicone provides similar functionality via proxy headers, Langfuse offers a different approach with its hierarchical trace/generation/span model that maps naturally to OpenCode's session/message/part structure.

This plugin enables:
- Session transcript export to Langfuse for debugging and analysis
- Cost/usage tracking across sessions
- Tool call visibility with input/output logging
- Session grouping in Langfuse's Sessions view

## What Changes

Implement a complete OpenCode plugin that:

1. **Hooks into OpenCode events** - Captures session lifecycle, message updates, and tool executions
2. **Maps to Langfuse hierarchy** - Translates OpenCode concepts to Langfuse traces, generations, and spans
3. **Exports asynchronously** - Uses Langfuse SDK's batching with disk spool fallback
4. **Provides privacy controls** - Supports redaction patterns and metadata-only mode

### Architecture (Effect.ts)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenCode Runtime                             │
└───────────────┬─────────────────────────────────────────────────────┘
                │ Events (session.*, message.*, tool.*)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Langfuse Exporter Plugin (Effect-based)              │
│                                                                      │
│  event() hook ──► Queue.bounded(1000) ──► Stream.fromQueue          │
│                          │                                           │
│                          ▼                                           │
│                Stream.groupByKey (by partId/messageId)               │
│                          │                                           │
│                          ▼                                           │
│                Stream.debounce("10 seconds") per key                 │
│                          │                                           │
│                          ▼                                           │
│                Dedup via Ref<HashSet<ProcessedId>>                   │
│                          │                                           │
│                          ▼                                           │
│                Transform ──► Redact ──► LangfuseClient               │
│                          │                                           │
│                Effect.retry(5 attempts, exponential backoff)         │
│                          │                                           │
│                          ▼                                           │
│                ┌─────────────────┐    ┌─────────────────┐           │
│                │  Langfuse SDK   │    │ Write-Behind Log│           │
│                │   (primary)     │    │   (audit/debug) │           │
│                └────────┬────────┘    └─────────────────┘           │
└─────────────────────────┼───────────────────────────────────────────┘
                          ▼
                  ┌─────────────┐
                  │   Langfuse  │
                  │   Server    │
                  └─────────────┘
```

#### Effect Services

| Service | Type | Purpose |
|---------|------|---------|
| `EventQueue` | `Queue.bounded(1000)` | Backpressure-aware event buffer |
| `SessionState` | `Ref<Map<sessionId, TraceState>>` | Track active traces/generations |
| `ProcessedIds` | `Ref<HashSet<string>>` | Deduplication of processed events |
| `LangfuseClient` | Effect service | SDK wrapper with retry logic |
| `PinoLogger` | Effect Logger | Pino-backed structured logging |

### Key Design Decisions

- **Event-driven capture**: Use OpenCode's `event` hook for real-time capture (no transcript file polling)
- **Deterministic IDs**: Session IDs derived via hash for idempotency across restarts
- **Graceful degradation**: Effect.retry handles transient failures; OpenCode never blocks
- **Privacy by default**: Built-in patterns for common secrets (API keys, tokens, etc.)
- **Effect.ts streaming**: Debounce per event key (10s) to handle streaming chunk problem
- **Bounded queue**: Backpressure with Queue.bounded(1000) - blocks producer if queue full
- **Write-behind log**: Optional audit log replaces retry queue (Effect handles retries)

## Impact

- **Affected specs**: None (new plugin)
- **New files**:
  - `src/index.ts` - Plugin entry (thin wrapper) ⚠️ Needs Effect rewrite
  - `src/effect/runtime.ts` - Effect runtime & layers
  - `src/effect/constants.ts` - Configuration constants
  - `src/effect/errors.ts` - Custom Effect errors
  - `src/effect/services/*.ts` - Effect services (EventQueue, SessionState, etc.)
  - `src/effect/streams/EventProcessor.ts` - Main stream pipeline
  - `src/effect/handlers/*.ts` - Event handlers (Session, Message, Tool)
  - `src/lib/config.ts` - Configuration loader ✅ Complete (keep)
  - `src/lib/session-id.ts` - ID utilities ✅ Complete (keep)
  - `src/lib/redaction.ts` - Privacy controls ✅ Complete (keep)
  - `src/lib/spool.ts` - Write-behind audit log ✅ Complete (repurpose)
  - `src/lib/langfuse-client.ts` - ⚠️ Will be replaced by Effect service
  - `test/*.test.ts` - Unit tests (needs Effect/TestClock tests)
  - `README.md` - Documentation ✅ Complete
- **Dependencies**: `langfuse`, `@opencode-ai/plugin`, `effect`

## Non-Goals

- Proxy routing (LLM calls stay direct)
- Real-time streaming to Langfuse (batched export is sufficient)
- Custom Langfuse UI or dashboards
- Automatic session summarization

## Future Possibilities

- **Langfuse Datasets**: Export sessions to datasets for fine-tuning
- **Cost alerts**: Trigger notifications based on usage thresholds
- **Prompt versioning**: Track prompt templates across sessions
