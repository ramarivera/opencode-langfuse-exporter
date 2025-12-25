# Project Context

## Purpose

OpenCode Langfuse Exporter is an OpenCode plugin that exports session transcripts and telemetry data to Langfuse asynchronously. This is an **exporter-only plugin** (NO proxy routing) - LLM provider calls stay direct while session data is shipped to Langfuse for observability.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Package Manager**: Bun
- **Task Runner**: mise (see `mise.toml`)
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **Build**: Bun bundler + tsc for declarations
- **Effect.ts**: Functional effect system for streaming, concurrency, and error handling

## Project Conventions

### Code Style

- ES6 `import`/`export` syntax (ESM modules)
- Single quotes, 2-space indentation, 100 char line width
- Explicit type annotations over inference
- NeverNesters pattern: avoid deep nesting, exit early
- Group imports: external libraries first, then internal modules

### Error Handling

- Check error type before accessing properties: `error instanceof Error ? error.toString() : String(error)`
- Log errors with `[langfuse-exporter]` prefix for consistency
- Never throw errors that would block OpenCode UX
- Use Effect's typed errors (`Effect.fail()`) for recoverable failures
- Use `Effect.retry()` with `Schedule` for transient failures (network, Langfuse API)

### Effect.ts Patterns

- **Services**: Use `Context.Tag` for dependency injection (LangfuseClient, EventQueue, etc.)
- **Streaming**: Use `Stream.fromQueue` with `Stream.debounce` for event batching
- **State**: Use `Ref<T>` for mutable state (session tracking, deduplication)
- **Concurrency**: Use `Queue.bounded` for backpressure (1000 event capacity)
- **Retry**: Use `Schedule.exponential` with jitter for Langfuse API calls
- **Testing**: Use `TestClock` for fast, deterministic debounce tests

### Repository Structure

```
opencode-langfuse-exporter/
├── src/
│   ├── index.ts              # Plugin entry point (thin wrapper)
│   ├── effect/
│   │   ├── runtime.ts        # Effect runtime & layer composition
│   │   ├── constants.ts      # Configuration constants
│   │   ├── errors.ts         # Custom Effect errors
│   │   ├── services/
│   │   │   ├── EventQueue.ts     # Queue.bounded for incoming events
│   │   │   ├── SessionState.ts   # Ref for session/trace state
│   │   │   ├── ProcessedIds.ts   # Ref<HashSet> for deduplication
│   │   │   ├── LangfuseClient.ts # Langfuse SDK as Effect service
│   │   │   └── PinoLogger.ts     # Pino-backed Effect Logger
│   │   ├── streams/
│   │   │   ├── EventProcessor.ts # Main stream pipeline with debounce
│   │   │   └── types.ts          # Stream event types
│   │   └── handlers/
│   │       ├── SessionHandler.ts # session.* events
│   │       ├── MessageHandler.ts # message.* events
│   │       └── ToolHandler.ts    # tool.execute.* hooks
│   └── lib/
│       ├── config.ts         # Configuration loading
│       ├── session-id.ts     # Deterministic ID generation
│       ├── redaction.ts      # Privacy/redaction utilities
│       └── spool.ts          # Write-behind audit log (optional)
├── test/                     # Unit tests (Effect + TestClock)
├── openspec/                 # OpenSpec workflow files
│   ├── project.md            # This file
│   └── changes/              # Proposed changes
├── .beads/                   # Beads issue tracking
├── dist/                     # Build output
├── AGENTS.md                 # AI assistant instructions
└── README.md                 # User documentation
```

## Domain Context

### OpenCode Plugin System

Plugins hook into OpenCode events and behavior:
- `event` hook: Receives ALL events (session, message, part updates)
- `tool.execute.before/after`: Hook tool execution
- `chat.message`: Hook user messages
- `config`: Modify configuration at runtime

### Langfuse Concepts

- **Trace**: Represents one logical unit of work (OpenCode session)
- **Generation**: LLM call with model info, input/output, usage stats
- **Span**: Generic operation (user message, tool call)
- **Session**: Groups traces by `sessionId` parameter

### Mapping OpenCode → Langfuse

| OpenCode Concept   | Langfuse Concept                      |
| ------------------ | ------------------------------------- |
| Session            | Trace with `sessionId` parameter      |
| Session ID         | `sessionId` (stable, deterministic)   |
| Session Title      | Trace `name`                          |
| User Message       | `span()` with name="user-message"     |
| Assistant Response | `generation()` with model/usage       |
| Tool Call          | `span()` with name="tool-{toolName}"  |

## Important Constraints

- **NO proxy routing**: LLM provider calls stay direct
- **Non-blocking**: Exporting must never block OpenCode UX
- **Resilient**: Langfuse downtime must NOT break OpenCode
- **Privacy-aware**: Support redaction and metadata-only modes

## External Dependencies

- `langfuse` - Langfuse TypeScript SDK
- `@opencode-ai/plugin` - OpenCode plugin system
- `@opencode-ai/sdk` - OpenCode SDK types (dev)
