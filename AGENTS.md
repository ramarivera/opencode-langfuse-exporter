# AGENTS.md

## Build & Test Commands

- **Build**: `mise run build` or `bun build ./src/index.ts --outdir dist --target bun`
- **Test**: `mise run test` or `bun test`
- **Single Test**: `bun test BackgroundTask.test.ts` (use file glob pattern)
- **Watch Mode**: `bun test --watch`
- **Lint**: `mise run lint` (eslint)
- **Fix Lint**: `mise run lint:fix` (eslint --fix)
- **Format**: `mise run format` (prettier)

## Code Style Guidelines

### Imports & Module System

- Use ES6 `import`/`export` syntax (module: "ESNext", type: "module")
- Group imports: external libraries first, then internal modules
- Use explicit file extensions (`.ts`) for internal imports

### Formatting (Prettier)

- **Single quotes** (`singleQuote: true`)
- **Line width**: 100 characters
- **Tab width**: 2 spaces
- **Trailing commas**: ES5 (no trailing commas in function parameters)
- **Semicolons**: enabled

### TypeScript & Naming

- **NeverNesters**: avoid deeply nested structures. Always exit early.
- **Strict mode**: enforced (`"strict": true`)
- **Classes**: PascalCase (e.g., `BackgroundTask`, `BackgroundTaskManager`)
- **Methods/properties**: camelCase
- **Status strings**: use union types (e.g., `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`)
- **Explicit types**: prefer explicit type annotations over inference
- **Return types**: optional (not required but recommended for public methods)

### Error Handling

- Check error type before accessing error properties: `error instanceof Error ? error.toString() : String(error)`
- Log errors with `[ERROR]` prefix for consistency
- Always provide error context when recording output

### Linting Rules

- `@typescript-eslint/no-explicit-any`: warn (avoid `any` type)
- `no-console`: error (minimize console logs)
- `prettier/prettier`: error (formatting violations are errors)

## Testing

- Framework: **vitest** with `describe` & `it` blocks
- Style: Descriptive nested test cases with clear expectations
- Assertion library: `expect()` (vitest)

## Memory

- Store temporary data in `.memory/` directory (gitignored)

## Project Context

- **Type**: ES Module package for OpenCode plugin system
- **Target**: Bun runtime, ES2021+
- **Purpose**: Async Langfuse exporter for OpenCode sessions (no proxy routing)

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

## Specifications

This project uses **OpenSpec** for feature specifications.
Specs are stored in the `openspec/` directory.

**Quick reference:**
- `openspec list` - List all specs
- `openspec create <name>` - Create a new spec
- `openspec show <name>` - View a spec

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
