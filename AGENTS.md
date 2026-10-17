# AGENTS.md

## Project Overview

`opencode-usage-limits` is a trimmed fork of
`@mynameistito/opencode-usage-limits` (upstream commit in `.upstream-commit`).
It is an OpenCode v2 TUI plugin in TypeScript showing usage limits for exactly
four providers: `codex`, `opencode-go`, `zai`, `kimi`. Keep the provider set closed:
adding a provider means auditing its adapter the way the current adapters were
audited (credential handling, official-host guards, bounded HTTP).

## Repo Layout

- `src/` plugin core: providers, config, coordinator, TUI components
- `src/providers/` one adapter per provider plus the shared runtime
- `__tests__/` vitest suites (colocated per module)
- `examples/` sample `usage-limits.jsonc`
- `usage-limits.schema.json` published JSON schema for the config file

## Important Commands

- `npm install`
- `npm run typecheck`
- `npm test` — vitest; `NODE_OPTIONS=--experimental-ffi` is required for the
  `@opentui` test renderer and is already set in the script
- `npm run build` — tsdown to `dist/` (renames the hashed `.d.mts`)

## Style And Workflow

- TypeScript, strict; no default exports except the plugin entrypoint.
- Effect for provider adapters; keep credentials inside `Redacted`.
- Providers must use `ProviderHttpClient` (bounded, interruptible); no direct
  `fetch`, no `child_process` — the subprocess runtime was removed on purpose.
- Keep `usage-limits.schema.json` and `examples/usage-limits.jsonc` in sync
  with `src/config-schema.ts` (`__tests__/config.test.ts` cross-checks them).
- Comments, identifiers, and messages are English-only.

## Testing Guidance

- Tests live in `__tests__/`, colocated `*.test.ts(x)` files.
- Do not mock away meaningful provider behavior; reuse
  `__tests__/providers/helpers.ts` fetch mock.

## Syncing Upstream

Upstream monorepo: `mynameistito/opencode-plugins`, package
`packages/opencode-usage-limits`. When pulling upstream changes, re-apply the
trim: only `codex.ts`, `opencode-go.ts`, `zai-coding-plan.ts`, `kimi.ts` providers, no
`runtime/command.ts`, no extra auth entries. Update `.upstream-commit` after a
successful sync.
