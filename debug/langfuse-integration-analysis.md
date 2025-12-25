# Langfuse Integration Analysis for OpenCode

> Deep dive into how to achieve full observability integration between OpenCode and Langfuse.
>
> **Last Updated**: 2024-12-25

---

## 📊 Executive Summary

### What We're Currently Sending to Langfuse

| Data                 | Source                             | Langfuse Entity   | Status     |
| -------------------- | ---------------------------------- | ----------------- | ---------- |
| Session lifecycle    | `session.created/updated/deleted`  | Trace             | ✅ Working |
| Session title        | `session.updated`                  | Trace name        | ✅ Working |
| User messages        | `message.updated` (role=user)      | Span              | ✅ Working |
| User message content | `message.part.updated` (text)      | Span input        | ✅ Working |
| Assistant messages   | `message.updated` (role=assistant) | Generation        | ✅ Working |
| Assistant response   | `message.part.updated` (text)      | Generation output | ✅ Working |
| Token usage (basic)  | `message.updated`                  | Generation usage  | ✅ Working |
| Model ID             | `message.updated`                  | Generation model  | ✅ Working |
| Tool calls           | `message.part.updated` (tool)      | Span (child)      | ✅ Working |
| Tool input/output    | `message.part.updated` (tool)      | Span input/output | ✅ Working |

### What We COULD Send But Are NOT

| Data                          | Source                                    | Langfuse Entity                | OpenCode Change? |
| ----------------------------- | ----------------------------------------- | ------------------------------ | ---------------- |
| **Cost**                      | `message.updated` (cost)                  | Generation `costDetails`       | ❌ NO            |
| **Reasoning tokens**          | `message.updated` (tokens)                | Generation `usageDetails`      | ❌ NO            |
| **Cache tokens (read/write)** | `message.updated` (tokens.cache)          | Generation `usageDetails`      | ❌ NO            |
| **Parent message ID**         | `message.updated` (parentID)              | Conversation threading         | ❌ NO            |
| **Message timestamps**        | `message.updated` (time)                  | Generation start/end time      | ❌ NO            |
| **File diffs (full content)** | `session.diff` event                      | Trace metadata / Span          | ❌ NO            |
| **Model parameters**          | `chat.params` hook                        | Generation `modelParameters`   | ❌ NO            |
| **Tool schemas**              | `tool.list` API (one-time fetch)          | Trace metadata                 | ❌ NO            |
| **Reasoning content (parts)** | `message.part.updated` (reasoning)        | Generation output (structured) | ❌ NO            |
| **System prompt**             | `experimental.chat.system.transform` hook | Generation input.system        | ✅ YES (#6142)   |

---

## 🎯 Priority Breakdown

### P0: Quick Wins (No OpenCode Changes Required)

These fields are **already available** in events but we're **not mapping them**:

```typescript
// In message.updated event, AssistantMessage contains:
{
  cost: number,                    // → costDetails.total
  tokens: {
    input: number,                 // → usageDetails.input (already mapped)
    output: number,                // → usageDetails.output (already mapped)
    reasoning: number,             // → usageDetails.reasoning ❌ NOT MAPPED
    cache: {
      read: number,                // → usageDetails.cache_read_input_tokens ❌ NOT MAPPED
      write: number                // → usageDetails.cache_write_input_tokens ❌ NOT MAPPED
    }
  },
  parentID: string,                // → For conversation threading ❌ NOT MAPPED
  time: {
    created: number,               // → startTime ❌ NOT MAPPED
    completed: number              // → endTime ❌ NOT MAPPED
  }
}
```

### P1: Additional Events/Hooks (No OpenCode Changes Required)

| Source                 | Data Available                                        | Implementation            |
| ---------------------- | ----------------------------------------------------- | ------------------------- |
| `session.diff` event   | Full file diffs (before, after, additions, deletions) | Subscribe to event        |
| `chat.params` hook     | temperature, topP, topK, provider options             | Register hook handler     |
| `tool.list` API        | Tool IDs, descriptions, JSON parameter schemas        | Fetch once at start       |
| `message.part.updated` | Reasoning parts (type=reasoning)                      | Already have, just filter |

### P2: Requires OpenCode Changes (BLOCKED by #6142)

Both experimental hooks lack `sessionID` in their input, making it impossible to correlate data to traces.

| Data                 | Hook                                   | Required Change               | GitHub Issue |
| -------------------- | -------------------------------------- | ----------------------------- | ------------ |
| System prompt        | `experimental.chat.system.transform`   | Add `sessionID` to hook input | #6142        |
| Full message history | `experimental.chat.messages.transform` | Add `sessionID` to hook input | #6142        |

**Status**: Cannot implement until OpenCode PR #6142 is merged.

---

## 🔧 What We Can Leverage from Grimoire

The `neuro-grimoire/packages/shared-opencode` package has useful utilities:

### 1. IntrospectionFormatter (`introspection-formatter.ts`)

Transforms raw tool parts into human-readable summaries. We can use/adapt:

```typescript
// Tool-specific formatters with smart summaries
formatEditTool(state); // → "src/index.ts (+5, -2)"
formatBashTool(state); // → "npm test → exit 0"
formatGlobTool(state); // → "**/*.ts → 42 files"
formatGrepTool(state); // → "TODO in *.ts → 15 matches"
formatReadTool(state); // → "src/index.ts (lines 1-50)"

// Diff trimming for concise previews
trimUnifiedDiff(diff, contextLines);

// Duration calculation from tool state
getDuration(state); // → Returns milliseconds or undefined
```

### 2. Type Definitions (`types.ts`)

```typescript
interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface TimingInfo {
  start: number;
  end: number;
  durationMs: number;
}

interface FormattedToolCall {
  type: 'tool';
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  summary: string; // Human-readable one-liner
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}
```

---

## 📋 Complete Data Available from OpenCode

### Events (Bus.publish)

| Event                  | Payload                                     | Currently Using? |
| ---------------------- | ------------------------------------------- | ---------------- |
| `session.created`      | `{ info: Session.Info }`                    | ✅ Yes           |
| `session.updated`      | `{ info: Session.Info }`                    | ✅ Yes           |
| `session.deleted`      | `{ info: Session.Info }`                    | ✅ Yes           |
| `session.diff`         | `{ sessionID, diff: FileDiff[] }`           | ❌ **No**        |
| `session.error`        | `{ sessionID?, error: NamedError }`         | ❌ No            |
| `message.updated`      | `{ info: MessageV2.Info }`                  | ⚠️ Partial       |
| `message.part.updated` | `{ part: Part, delta?: string }`            | ⚠️ Partial       |
| `message.removed`      | `{ sessionID, messageID }`                  | ❌ No            |
| `command.executed`     | `{ name, arguments, sessionID, messageID }` | ❌ No            |
| `permission.updated`   | `{ id, type, title, metadata, sessionID }`  | ❌ No            |
| `permission.replied`   | `{ sessionID, permissionID, response }`     | ❌ No            |
| `lsp.diagnostics`      | `{ serverID, path }`                        | ❌ No            |
| `file.edited`          | `{ file: string }`                          | ❌ No            |

### Plugin Hooks

| Hook                                   | Data Exposed                             | Has sessionID? | Currently Using?    |
| -------------------------------------- | ---------------------------------------- | -------------- | ------------------- |
| `chat.message`                         | `message`, `parts`, `model`, `agent`     | ✅ Yes         | ❌ No               |
| `chat.params`                          | `temperature`, `topP`, `topK`, `options` | ✅ Yes         | ❌ **No** (planned) |
| `tool.execute.before`                  | `tool`, `args`, `callID`                 | ✅ Yes         | ❌ No               |
| `tool.execute.after`                   | `output`, `metadata`, `title`            | ✅ Yes         | ❌ No               |
| `experimental.chat.system.transform`   | `{}` → `{ system: string[] }`            | ❌ **No**      | 🚫 BLOCKED by #6142 |
| `experimental.chat.messages.transform` | `{}` → transformed messages              | ❌ **No**      | 🚫 BLOCKED by #6142 |
| `experimental.session.compacting`      | `context`, `prompt`                      | ✅ Yes         | ❌ No               |
| `permission.ask`                       | `Permission.Info`                        | ✅ Yes         | ❌ No               |

### API Endpoints (One-time fetch)

| Endpoint                 | Data Available                            | Useful For           |
| ------------------------ | ----------------------------------------- | -------------------- |
| `GET /experimental/tool` | Tool IDs, descriptions, parameter schemas | Trace metadata       |
| `GET /session/:id/diff`  | Full file diffs                           | Same as session.diff |

---

## 🗺️ Langfuse Data Model Mapping

### Trace (Session Level)

```typescript
langfuse.trace({
  id: sessionToUUID(sessionId),
  sessionId: sessionId,
  name: sessionTitle,
  metadata: {
    // From session.diff event
    filesChanged: diff.map((d) => d.file),
    totalAdditions: diff.reduce((sum, d) => sum + d.additions, 0),
    totalDeletions: diff.reduce((sum, d) => sum + d.deletions, 0),
    // From tool.list API (once at start)
    availableTools: toolSchemas.map((t) => t.id),
  },
  tags: ['opencode', providerID, modelID],
});
```

### Generation (LLM Call)

```typescript
langfuse.generation({
  id: observationId,
  traceId: traceId,
  parentObservationId: parentMessageId, // NEW: Conversation threading
  name: 'assistant-response',
  model: `${providerID}/${modelID}`,

  // NEW: System prompt (requires #6142)
  input: {
    system: systemPromptArray,
    messages: conversationHistory,
  },

  output: assistantResponse,

  // NEW: Model parameters (from chat.params hook)
  modelParameters: {
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
  },

  // ENHANCED: Complete usage details
  usageDetails: {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning, // NEW
    cache_read_input_tokens: tokens.cache.read, // NEW
    cache_write_input_tokens: tokens.cache.write, // NEW
    total: tokens.input + tokens.output + tokens.reasoning,
  },

  // NEW: Cost tracking
  costDetails: {
    total: cost,
    currency: 'USD',
  },

  // NEW: Accurate timing
  startTime: new Date(time.created),
  endTime: new Date(time.completed),
});
```

### Span (Tool Call) - Enhanced with Grimoire Formatters

```typescript
// Use grimoire's formatToolPart for smart summaries
const formatted = formatToolPart(toolPart, { includeDiffPreview: true });

langfuse.span({
  traceId: traceId,
  parentObservationId: generationId,
  name: `tool-${toolName}`,

  // Smart formatting from grimoire
  input: formatted.input,
  output: formatted.output,

  metadata: {
    toolCallId: callID,
    status: formatted.status,
    summary: formatted.summary, // e.g., "src/index.ts (+5, -2)"
    error: formatted.error,
  },

  // Accurate timing
  startTime: new Date(state.time.start),
  endTime: new Date(state.time.end),
});
```

---

## 📝 Implementation Checklist

### Phase 1: Quick Wins (This PR)

- [ ] Map `cost` → `costDetails.total`
- [ ] Map `tokens.reasoning` → `usageDetails.reasoning`
- [ ] Map `tokens.cache.read` → `usageDetails.cache_read_input_tokens`
- [ ] Map `tokens.cache.write` → `usageDetails.cache_write_input_tokens`
- [ ] Map `parentID` for conversation threading
- [ ] Map `time.created/completed` → `startTime/endTime`

### Phase 2: Additional Data Sources (Next PR)

- [ ] Subscribe to `session.diff` event for file change tracking
- [ ] Register `chat.params` hook for model parameters
- [ ] Fetch tool schemas via `tool.list` API at session start
- [ ] Handle `reasoning` message parts separately

### Phase 3: OpenCode Changes Required (BLOCKED by #6142)

Both experimental hooks (`experimental.chat.system.transform` and `experimental.chat.messages.transform`) have empty `{}` input with no `sessionID`, making it impossible to correlate captured data to specific traces.

- [ ] Wait for / contribute to #6142 (add sessionID to experimental hooks)
- [ ] Register `experimental.chat.system.transform` hook for system prompt capture
- [ ] Register `experimental.chat.messages.transform` hook for full message history
- [ ] Store and attach system prompts to generations

### Phase 4: Nice-to-Have Enhancements

- [ ] Leverage grimoire's `formatToolPart` for smart tool summaries
- [ ] Track `command.executed` events as spans
- [ ] Track `permission.*` events for human-in-the-loop visibility
- [ ] Track `lsp.diagnostics` for code quality context

---

## 🧪 Testing with Local Langfuse

```bash
# Your Langfuse instance
export LANGFUSE_PUBLIC_KEY=pk-lf-23599281-725a-4af4-9f50-3852ed8aa231
export LANGFUSE_SECRET_KEY=sk-lf-76fc2e45-82f1-4303-9e02-af8dc1f6c282
export LANGFUSE_HOST=http://localhost:3200
```

---

## 🔗 References

- [GitHub Issue #6142](https://github.com/sst/opencode/issues/6142) - System prompt sessionID
- [Langfuse JS SDK Docs](https://langfuse.com/docs/sdk/typescript/guide)
- [OpenCode Event System](~/dev/opencode--ramarivera/packages/opencode/src/bus/)
- [OpenCode Plugin API](https://opencode.ai/docs/plugins/)
- [Grimoire IntrospectionFormatter](~/dev/neuro-grimoire/packages/shared-opencode/src/introspection-formatter.ts)
