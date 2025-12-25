# Tasks: Implement OpenCode Langfuse Exporter

## Implementation Status

**Current State**: Core Effect.ts streaming pipeline complete. Now enhancing data capture.

**Previous Bug Fixed**: Duplicate observations (440 vs expected 10-20) resolved via Effect.ts `Stream.debounce` per event key.

**New Discovery (2024-12-25)**: Comprehensive analysis revealed additional data sources available without OpenCode changes.

---

## Completed Phases

### Phase 1-6: Foundation (Complete)

- [x] Project setup, configuration, session IDs, redaction, spool, documentation

### Phase 7-11: Effect.ts Core (Complete)

- [x] Effect foundation (constants, errors, runtime, types)
- [x] Effect services (EventQueue, SessionState, ProcessedIds, LangfuseClient, PinoLogger)
- [x] Stream pipeline with debounce
- [x] Event handlers (Session, Message, Tool)
- [x] Plugin integration

---

## Phase 15: Quick Wins - Enhanced Data Mapping

**Goal**: Map all available data from existing events (no OpenCode changes required).

### 15.1 Enhanced Token Usage

Currently we only map `input` and `output` tokens. The `message.updated` event contains more:

- [ ] 15.1.1 Map `tokens.reasoning` → `usageDetails.reasoning`
- [ ] 15.1.2 Map `tokens.cache.read` → `usageDetails.cache_read_input_tokens`
- [ ] 15.1.3 Map `tokens.cache.write` → `usageDetails.cache_write_input_tokens`

```typescript
// In types.ts - Update MessageEvent
interface MessageEvent extends BasePluginEvent {
  // ... existing fields
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;        // NEW
    cacheReadTokens?: number;        // NEW
    cacheWriteTokens?: number;       // NEW
  };
  cost?: number;                     // NEW
}
```

### 15.2 Cost Tracking

- [ ] 15.2.1 Add `cost` field to MessageEvent type
- [ ] 15.2.2 Pass `cost` from `message.updated` event in `convertMessageEvent()`
- [ ] 15.2.3 Map to Langfuse `costDetails.total` in EventProcessor

```typescript
// In LangfuseClient.ts - Update GenerationData
interface GenerationData {
  // ... existing fields
  costDetails?: {
    total?: number;
    currency?: string;
  };
}
```

### 15.3 Conversation Threading

- [ ] 15.3.1 Add `parentMessageId` field to MessageEvent type
- [ ] 15.3.2 Extract `parentID` from AssistantMessage in `convertMessageEvent()`
- [ ] 15.3.3 Use as `parentObservationId` for proper Langfuse threading

### 15.4 Accurate Timing

- [ ] 15.4.1 Add `startTime` and `endTime` to MessageEvent type
- [ ] 15.4.2 Extract from `time.created` and `time.completed` in AssistantMessage
- [ ] 15.4.3 Pass to Langfuse Generation `startTime`/`endTime`

---

## Phase 16: Additional Data Sources

**Goal**: Subscribe to additional events and hooks for richer observability.

### 16.1 File Diffs (`session.diff` Event)

The `session.diff` event contains full file diff content:

```typescript
interface FileDiff {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}
```

- [ ] 16.1.1 Add `SessionDiffEvent` type to `types.ts`
- [ ] 16.1.2 Subscribe to `session.diff` in plugin `event()` handler
- [ ] 16.1.3 Store diffs in SessionState
- [ ] 16.1.4 Attach summary to Trace metadata (file count, total additions/deletions)
- [ ] 16.1.5 Optionally create spans for individual file changes

### 16.2 Model Parameters (`chat.params` Hook)

The `chat.params` hook exposes LLM parameters:

```typescript
"chat.params"?: (input: {
  temperature?: number;
  topP?: number;
  topK?: number;
  options?: Record<string, unknown>;
}) => Promise<void>
```

- [ ] 16.2.1 Register `chat.params` hook in plugin
- [ ] 16.2.2 Store parameters in SessionState (keyed by... messageId? Need to check)
- [ ] 16.2.3 Attach to Generation `modelParameters`

### 16.3 Tool Schemas (One-time API Fetch)

The `tool.list` API returns tool definitions with JSON schemas:

- [ ] 16.3.1 Fetch tool list via OpenCode SDK on session start
- [ ] 16.3.2 Store in SessionState
- [ ] 16.3.3 Attach tool IDs to Trace metadata
- [ ] 16.3.4 (Optional) Include full schemas for debugging

### 16.4 Reasoning Parts

OpenCode separates `reasoning` parts from `text` parts:

- [ ] 16.4.1 Handle `type: 'reasoning'` in `message.part.updated`
- [ ] 16.4.2 Store separately from main output
- [ ] 16.4.3 Structure Generation output as `{ reasoning: string, response: string }`

---

## Phase 17: System Prompt (Requires OpenCode #6142)

**Blocked by**: https://github.com/sst/opencode/issues/6142

### 17.1 System Prompt Capture

Once #6142 is merged:

- [ ] 17.1.1 Register `experimental.chat.system.transform` hook
- [ ] 17.1.2 Store system prompt array keyed by `sessionID`
- [ ] 17.1.3 Attach to next Generation as `input.system`

```typescript
// Hook handler
"experimental.chat.system.transform": async (input, output) => {
  systemPromptCache.set(input.sessionID, output.system);
}

// When creating generation
const systemPrompt = systemPromptCache.get(sessionId);
langfuse.generation({
  input: {
    system: systemPrompt,
    messages: conversationHistory
  }
})
```

---

## Phase 18: Grimoire Integration (Optional)

**Goal**: Leverage utilities from `neuro-grimoire/packages/shared-opencode`.

### 18.1 Tool Formatting

- [ ] 18.1.1 Import/adapt `formatToolPart()` for smart tool summaries
- [ ] 18.1.2 Use `trimUnifiedDiff()` for concise diff previews
- [ ] 18.1.3 Use `getDuration()` for accurate timing

### 18.2 Type Alignment

- [ ] 18.2.1 Align `TokenUsage` type with grimoire's definition
- [ ] 18.2.2 Align `FormattedToolCall` for consistent output

---

## Phase 19: Testing

### 19.1 Unit Tests for New Fields

- [ ] 19.1.1 Test cost mapping
- [ ] 19.1.2 Test reasoning token mapping
- [ ] 19.1.3 Test cache token mapping
- [ ] 19.1.4 Test conversation threading

### 19.2 Integration Tests

- [ ] 19.2.1 Verify cost appears in Langfuse UI
- [ ] 19.2.2 Verify token breakdown in Langfuse
- [ ] 19.2.3 Verify file diffs in trace metadata
- [ ] 19.2.4 Verify model parameters in generations

---

## Phase 20: Cleanup & Documentation

- [ ] 20.1 Update README with new features
- [ ] 20.2 Document all captured data fields
- [ ] 20.3 Update debug/langfuse-integration-analysis.md as implementation proceeds
- [ ] 20.4 Final lint and test pass

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Debounce duration | 10 seconds | Prefer meaningful traces over speed |
| Queue strategy | `Queue.bounded(1000)` | Backpressure over data loss |
| Error handling | Give up after 5 retries | Don't block OpenCode |
| File diffs | Store in trace metadata | Keep traces lightweight |
| System prompt | Blocked on #6142 | Can't correlate without sessionID |
| Grimoire utils | Optional import | Avoid hard dependency |

---

## Data Mapping Reference

### From `message.updated` (AssistantMessage)

| OpenCode Field | Langfuse Field | Status |
|----------------|----------------|--------|
| `tokens.input` | `usageDetails.input` | ✅ Done |
| `tokens.output` | `usageDetails.output` | ✅ Done |
| `tokens.reasoning` | `usageDetails.reasoning` | ❌ TODO |
| `tokens.cache.read` | `usageDetails.cache_read_input_tokens` | ❌ TODO |
| `tokens.cache.write` | `usageDetails.cache_write_input_tokens` | ❌ TODO |
| `cost` | `costDetails.total` | ❌ TODO |
| `parentID` | `parentObservationId` | ❌ TODO |
| `time.created` | `startTime` | ❌ TODO |
| `time.completed` | `endTime` | ❌ TODO |
| `modelID` | `model` | ✅ Done |
| `providerID` | `model` (prefix) | ✅ Done |

### From Events/Hooks

| Source | Data | Langfuse Mapping | Status |
|--------|------|------------------|--------|
| `session.diff` | File changes | Trace metadata | ❌ TODO |
| `chat.params` | temperature, topP, etc. | Generation modelParameters | ❌ TODO |
| `tool.list` API | Tool schemas | Trace metadata | ❌ TODO |
| `experimental.chat.system.transform` | System prompt | Generation input.system | ⏳ Blocked |
