# Tasks: Implement OpenCode Langfuse Exporter

## Implementation Status

**Current State**: Library modules complete, pivoting to Effect.ts for streaming/debounce.

**Bug Fixed**: Initial implementation had duplicate observations (440 vs expected 10-20) due to:
- `message.part.updated` firing on every streaming chunk
- `message.updated` firing multiple times per message
- No debounce/dedup logic

**Solution**: Effect.ts rewrite with `Stream.debounce` per event key.

---

## Completed Modules (Keep)

- `src/lib/config.ts` - Configuration loading with env vars and validation
- `src/lib/session-id.ts` - Deterministic UUID generation from session IDs
- `src/lib/redaction.ts` - Privacy controls with built-in and custom patterns
- `src/lib/spool.ts` - JSONL-based disk buffer (repurpose as write-behind log)
- `README.md` - Documentation

## Superseded (Will Replace)

- `src/lib/langfuse-client.ts` - Will become Effect service with retry
- `src/index.ts` - Will be thin wrapper around Effect runtime

---

## Phase 1: Project Setup ✅

- [x] 1.1 Clone plugin template and run setup.sh
- [x] 1.2 Update package.json with correct metadata and dependencies
- [x] 1.3 Configure tsconfig.json for strict TypeScript
- [x] 1.4 Add langfuse and @opencode-ai/plugin dependencies
- [x] 1.5 Set up eslint and prettier configuration
- [x] 1.6 Initialize git repository

## Phase 2: Configuration Module ✅

- [x] 2.1 Define `LangfuseExporterConfig` interface with all config options
- [x] 2.2 Implement `loadConfig()` to merge env vars and plugin config
- [x] 2.3 Implement `validateConfig()` to check required fields
- [x] 2.4 Support export modes: `full`, `metadata_only`, `off`
- [x] 2.5 Parse comma-separated redact patterns from env var

## Phase 3: Session ID Utilities ✅

- [x] 3.1 Implement `sessionToUUID()` for deterministic UUID from session ID
- [x] 3.2 Implement `generateTraceId()` for trace correlation
- [x] 3.3 Implement `generateIdempotencyKey()` for deduplication
- [x] 3.4 Implement `sanitizeForTrace()` for safe trace names

## Phase 4: Redaction Module ✅

- [x] 4.1 Define built-in patterns for common secrets (API keys, JWT, SSH keys)
- [x] 4.2 Implement `redactText()` with pattern matching
- [x] 4.3 Implement `redactObject()` for recursive object redaction
- [x] 4.4 Implement `processContent()` that respects export mode

## Phase 5: Disk Spool ✅ (Repurposed)

- [x] 5.1 Define `SpooledEvent` interface with idempotency key
- [x] 5.2 Implement `initSpool()` to create spool directory
- [x] 5.3 Implement `writeToSpool()` for JSONL append
- [x] 5.4 Implement `loadPendingEvents()` to read unprocessed events
- [x] 5.5 Implement `markProcessed()` for idempotency tracking
- [x] 5.6 Implement `cleanupSpool()` for retention and size limits

> **Note**: Spool repurposed as optional write-behind audit log. Effect.retry handles retries.

## Phase 6: Documentation ✅

- [x] 6.1 Write README with installation instructions
- [x] 6.2 Document required environment variables
- [x] 6.3 Document optional configuration options
- [x] 6.4 Add example opencode.json config snippet
- [x] 6.5 Add example .env files (cloud and self-hosted)
- [x] 6.6 Document how to verify in Langfuse UI
- [x] 6.7 Add troubleshooting section

---

## Phase 7: Effect Foundation

- [ ] 7.1 Add `effect` dependency to package.json
- [ ] 7.2 Create `src/effect/constants.ts` with configuration values
- [ ] 7.3 Create `src/effect/errors.ts` with custom Effect errors
- [ ] 7.4 Create `src/effect/runtime.ts` with layer composition
- [ ] 7.5 Create `src/effect/streams/types.ts` with stream event types

### Constants (7.2)
```typescript
export const DEBOUNCE_DURATION = "10 seconds"
export const QUEUE_CAPACITY = 1000
export const MAX_RETRY_ATTEMPTS = 5
export const RETRY_BASE_DELAY = "1 second"
export const RETRY_MAX_DELAY = "30 seconds"
```

## Phase 8: Effect Services

- [ ] 8.1 Create `EventQueue` service - `Queue.bounded(1000)` for incoming events
- [ ] 8.2 Create `SessionState` service - `Ref<Map<sessionId, TraceState>>` for tracking
- [ ] 8.3 Create `ProcessedIds` service - `Ref<HashSet<string>>` for deduplication
- [ ] 8.4 Create `PinoLogger` Effect layer - Pino-backed Effect logger
- [ ] 8.5 Create `LangfuseClient` Effect service with retry logic

### LangfuseClient Service (8.5)
```typescript
// Retry schedule: exponential backoff with jitter, max 5 attempts
const retrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.upTo("30 seconds"),
  Schedule.compose(Schedule.recurs(5))
)

// On final failure: log error, give up (don't block OpenCode)
```

## Phase 9: Stream Pipeline

- [ ] 9.1 Create `EventProcessor.ts` - Main stream pipeline
- [ ] 9.2 Implement `Stream.fromQueue` to consume from EventQueue
- [ ] 9.3 Implement `Stream.groupByKey` by partId/messageId
- [ ] 9.4 Implement `Stream.debounce("10 seconds")` per group
- [ ] 9.5 Implement deduplication check via ProcessedIds
- [ ] 9.6 Implement transform to Langfuse observations
- [ ] 9.7 Wire to LangfuseClient with retry

### Debounce Strategy (9.3-9.4)
```typescript
// Group by event key (partId for parts, messageId for messages)
// Each group gets independent 10s debounce
// Only emit final state after 10s of no updates
```

## Phase 10: Event Handlers

- [ ] 10.1 Create `SessionHandler.ts` for session.* events
  - [ ] 10.1.1 Handle `session.created` → create Langfuse trace
  - [ ] 10.1.2 Handle `session.updated` → update trace metadata
  - [ ] 10.1.3 Handle `session.delete` → finalize trace
- [ ] 10.2 Create `MessageHandler.ts` for message.* events
  - [ ] 10.2.1 Handle `message.updated` → queue for debounce
  - [ ] 10.2.2 Handle `message.part.updated` → queue for debounce
  - [ ] 10.2.3 Extract model info and token usage from assistant messages
- [ ] 10.3 Create `ToolHandler.ts` for tool.execute.* hooks
  - [ ] 10.3.1 Handle `tool.execute.before` → start tool span
  - [ ] 10.3.2 Handle `tool.execute.after` → end tool span with result

## Phase 11: Plugin Integration

- [ ] 11.1 Update `src/index.ts` as thin wrapper around Effect runtime
- [ ] 11.2 Initialize Effect runtime on plugin load
- [ ] 11.3 Wire `event` hook to push events to EventQueue
- [ ] 11.4 Wire `tool.execute.before/after` hooks to ToolHandler
- [ ] 11.5 Register process exit handler for graceful shutdown
- [ ] 11.6 Apply redaction to all content before export

## Phase 12: Effect Tests

- [ ] 12.1 Write EventQueue service tests
- [ ] 12.2 Write SessionState service tests
- [ ] 12.3 Write ProcessedIds deduplication tests
- [ ] 12.4 Write LangfuseClient retry tests (mock SDK)
- [ ] 12.5 Write EventProcessor stream tests with TestClock
- [ ] 12.6 Write handler unit tests

### TestClock Usage (12.5)
```typescript
// Fast, deterministic debounce tests
const test = Effect.gen(function* () {
  // ... setup stream with debounce
  yield* TestClock.adjust("10 seconds") // Instant!
  // ... verify output
}).pipe(Effect.provide(TestContext.TestContext))
```

## Phase 13: Integration Testing

- [ ] 13.1 Start self-hosted Langfuse at localhost:3200
- [ ] 13.2 Configure plugin with Langfuse credentials
- [ ] 13.3 Create OpenCode session with user message
- [ ] 13.4 Trigger assistant response with tool call
- [ ] 13.5 Verify trace appears with correct observation count (~10-20, NOT 440)
- [ ] 13.6 Verify deduplication works (no duplicate observations)
- [ ] 13.7 Verify debounce works (streaming chunks consolidated)
- [ ] 13.8 Test with Langfuse unreachable (verify retry then give up)

## Phase 14: Cleanup

- [ ] 14.1 Remove old `src/lib/langfuse-client.ts` (replaced by Effect service)
- [ ] 14.2 Update spool.ts to be opt-in write-behind log
- [ ] 14.3 Run linter and fix all errors
- [ ] 14.4 Ensure all tests pass
- [ ] 14.5 Update AGENTS.md with Effect patterns
- [ ] 14.6 Final commit

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Debounce duration | 10 seconds | Prefer meaningful traces over speed |
| Queue strategy | `Queue.bounded(1000)` | Backpressure over data loss |
| Error handling | Give up after 5 retries | Don't block OpenCode |
| Spool.ts | Opt-in write-behind log | Effect handles retries |
| Logger | Effect Logger → Pino | Best of both worlds |
| Testing | TestClock + integration | Fast unit + realistic integration |
