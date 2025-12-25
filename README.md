# opencode-langfuse-exporter

Async Langfuse exporter for OpenCode sessions. Ships session transcripts and telemetry to [Langfuse](https://langfuse.com) for observability - **no proxy routing**, LLM provider calls remain direct.

## Features

- **Async Export** - Non-blocking telemetry export, never slows down your OpenCode sessions
- **Session Grouping** - All messages within an OpenCode session appear as a single trace in Langfuse
- **Privacy Controls** - Built-in redaction patterns for API keys, secrets, and sensitive data
- **Metadata-Only Mode** - Export session metadata without content for privacy-sensitive environments
- **Resilient Spooling** - Disk-based queue ensures no data loss during Langfuse outages
- **Zero Proxy Overhead** - LLM calls go directly to providers; only observability data goes to Langfuse

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenCode Session                            │
├─────────────────────────────────────────────────────────────────────┤
│  User Message  →  LLM Provider (direct)  →  Assistant Response      │
│       │                                              │              │
│       └──────────────┬───────────────────────────────┘              │
│                      ▼                                              │
│               Langfuse Exporter                                     │
│                      │                                              │
│          ┌───────────┴───────────┐                                  │
│          ▼                       ▼                                  │
│    Local Spool            Langfuse API                              │
│    (crash-safe)           (async flush)                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install the Plugin

```bash
# Using npm
npm install opencode-langfuse-exporter

# Using bun
bun add opencode-langfuse-exporter
```

### 2. Configure OpenCode

Add to your `~/.config/opencode/config.json` (or `opencode.json` in your project):

```json
{
  "plugins": ["opencode-langfuse-exporter"]
}
```

### 3. Set Environment Variables

```bash
# Required - Langfuse credentials
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."

# Optional - Self-hosted Langfuse
export LANGFUSE_HOST="https://your-langfuse-instance.com"
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LANGFUSE_PUBLIC_KEY` | *required* | Your Langfuse public key |
| `LANGFUSE_SECRET_KEY` | *required* | Your Langfuse secret key |
| `LANGFUSE_HOST` | `https://cloud.langfuse.com` | Langfuse API endpoint |
| `OPENCODE_LANGFUSE_EXPORT_MODE` | `full` | `full`, `metadata_only`, or `off` |
| `OPENCODE_LANGFUSE_REDACT_REGEX` | *(none)* | Comma-separated regex patterns |
| `OPENCODE_LANGFUSE_FLUSH_INTERVAL` | `5000` | Flush interval in milliseconds |
| `OPENCODE_LANGFUSE_SPOOL_DIR` | `~/.opencode/langfuse-spool` | Local spool directory |
| `OPENCODE_LANGFUSE_MAX_SPOOL_MB` | `100` | Max spool size before cleanup |
| `OPENCODE_LANGFUSE_RETENTION_DAYS` | `7` | Days to retain spool files |
| `OPENCODE_LANGFUSE_TRACE_PREFIX` | *(none)* | Prefix for trace names |
| `OPENCODE_LANGFUSE_VERBOSE` | `false` | Enable verbose logging |
| `OPENCODE_LANGFUSE_ENABLED` | `true` | Enable/disable the exporter |

### Export Modes

- **`full`** - Export all session content with redaction applied
- **`metadata_only`** - Export session structure without message content
- **`off`** - Disable exporting entirely

### Custom Redaction Patterns

Add custom regex patterns to redact sensitive data:

```bash
# Redact internal user IDs and project codes
export OPENCODE_LANGFUSE_REDACT_REGEX="user-\d{8},PROJECT-[A-Z]{3}-\d+"
```

Built-in patterns automatically redact:
- API keys (`sk_*`, `pk_*`, `api_*`, etc.)
- AWS access keys (`AKIA...`)
- JWT tokens
- Bearer tokens
- SSH private keys

## Langfuse Trace Structure

Each OpenCode session maps to Langfuse as follows:

| OpenCode Concept | Langfuse Object |
|------------------|-----------------|
| Session | Trace with `sessionId` |
| Session Title | Trace `name` |
| User Message | Span (`name="user-message"`) |
| Assistant Response | Generation (with model/usage) |
| Tool Execution | Span (`name="tool-{toolName}"`) |

### Viewing in Langfuse

1. Navigate to **Traces** in your Langfuse dashboard
2. Filter by `sessionId` to see all messages in a session
3. Click on a trace to see the full conversation timeline
4. View token usage, latency, and model details per generation

## Logging

The plugin logs to files in `~/.opencode/langfuse-exporter/logs/`:

```
langfuse-exporter-2024-12-25.log
langfuse-exporter-2024-12-26.log
```

Logs use [Pino](https://getpino.io/) in JSON format for easy parsing:

```bash
# View today's logs
cat ~/.opencode/langfuse-exporter/logs/langfuse-exporter-$(date +%Y-%m-%d).log | jq

# Stream logs in real-time
tail -f ~/.opencode/langfuse-exporter/logs/*.log | jq
```

## Troubleshooting

### Traces Not Appearing in Langfuse

1. **Check credentials**: Ensure `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set
2. **Check logs**: Look for errors in `~/.opencode/langfuse-exporter/logs/`
3. **Verify host**: If self-hosting, confirm `LANGFUSE_HOST` is correct
4. **Check export mode**: Ensure `OPENCODE_LANGFUSE_EXPORT_MODE` is not `off`

### High Disk Usage in Spool

If Langfuse is unreachable, events queue in the spool directory:

```bash
# Check spool size
du -sh ~/.opencode/langfuse-spool/

# Manually clear old spool files (if needed)
find ~/.opencode/langfuse-spool -name "*.jsonl" -mtime +7 -delete
```

### Plugin Not Loading

Verify the plugin is correctly configured in OpenCode:

```bash
# Check OpenCode config
cat ~/.config/opencode/config.json
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Build
bun run build

# Lint
bun run lint

# Format
bun run format
```

### Running Tests

```bash
# All tests
bun run test

# Watch mode
bun run test:watch

# Coverage
bun run test:coverage
```

## Contributing

Contributions welcome! Please file issues or submit PRs on GitHub.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Author

Ramiro Rivera <ramarivera@example.com>

## Links

- [Langfuse Documentation](https://langfuse.com/docs)
- [OpenCode Plugins](https://opencode.ai/docs/plugins)
- [GitHub Repository](https://github.com/ramarivera/opencode-langfuse-exporter)
