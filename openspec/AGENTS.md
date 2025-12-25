# OpenSpec Instructions

This project uses **OpenSpec** for spec-driven development.

## Directory Structure

```
openspec/
├── project.md                           # Project context and conventions
├── AGENTS.md                            # This file
└── changes/
    └── implement-langfuse-exporter/     # Current change proposal
        ├── proposal.md                  # Why and what changes
        ├── tasks.md                     # Implementation checklist
        └── specs/
            └── langfuse-exporter/
                └── spec.md              # Detailed specification
```

## Workflow

1. **Read project.md** first to understand project context
2. **Check proposal.md** for the change motivation and scope
3. **Follow tasks.md** for implementation checklist
4. **Reference spec.md** for detailed requirements

## Commands

```bash
# List specs and changes
openspec list --specs
openspec list

# View a specific item
openspec show implement-langfuse-exporter
```

## Anti-Hallucination Protocol

After completing any task from tasks.md:
1. **Re-read the relevant section** in spec.md
2. **Verify** the implementation matches the spec exactly
3. **Correct** any discrepancies before moving on
