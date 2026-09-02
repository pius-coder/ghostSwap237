# User Taste Profile

## Communication

- Prefers to work in French for both tasks and final reports. Confidence: 1.0
- Provides detailed, step-by-step task specifications with explicit scope boundaries (what NOT to do). Confidence: 0.9

## Tooling & Runtime

- Uses Bun exclusively for tests, builds, lint and dependency management. Confidence: 1.0

## Pre-Action Rules

- Must read the project's `AGENTS.md` file in full before taking any action, and must respect all its rules. Confidence: 1.0

## Source Control Practices

- Avoids destructive Git operations (`git reset --hard`, `git checkout --`, `git clean -fd`, force push, destructive rebase). Confidence: 0.95
- Never loses, overwrites or restores user changes without explicit justification. Confidence: 0.95
- Prefers coherent, verified commits and avoids partially misleading or incomplete commits. Confidence: 0.9

## Platform Targeting

- Targets Windows 11 and has explicitly abandoned Windows 10 support for the Henshin project. Confidence: 0.95

## Project Context

- Henshin repository: `C:\Users\HP\ghostSwap237`. Confidence: 0.95
- Reference FXSwap37 repository: `C:\Users\HP\fxswap37`. Confidence: 0.95
- Active Henshin branch: `codex/henshin-platform-rebuild`. Confidence: 0.95
