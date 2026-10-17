# opencode-usage-limits

[English](README.md) | [Русский](README.ru.md)

OpenCode v2 TUI plugin: shows **OpenCode GO**, **OpenAI/Codex**, **Z.AI
Coding Plan**, and **Kimi Code** usage limits in the sidebar and a compact indicator in the prompt
footer.

Quota requests use the shared bounded HTTP client. The plugin does not spawn
processes or write credentials. Kimi Code is the default configuration example.

## What it does

- Sidebar block `Usage Limits` under the Context section, refreshed every
  `refreshIntervalSeconds` (default 60).
- Prompt-footer indicator for the provider of the current session.
- Credentials are read from OpenCode auth (`~/.local/share/opencode/auth.json`)
  first; per-provider `apiKey`/`authPath` config and `{env:VAR}` references are
  fallbacks.
- The Kimi adapter uses a fixed official HTTPS endpoint and rejects redirects.

## Install from GitHub (no npm publishing)

The plugin does not need to be published to npm. Clone the repository,
build it with Bun, and tell OpenCode to load that local directory. No `npm`
command, global package link, or `opencode plugin add` is needed.

**Requirements:** Git, [Bun](https://bun.sh/), and OpenCode V2 (tested with **2.0.32**).
If the GitHub repository is private, you also need read access.
The commands below are for Linux/macOS. Bun still downloads dependencies from
the npm registry: this is not an offline or registry-free installation.

### 1. Clone and build

The example uses SSH; configure a GitHub SSH key first. For a private repository,
the key must have read access. Do not put a GitHub token in the URL.

```sh
git clone git@github.com:sakateka/opencode-usage-limits.git "$HOME/.local/share/opencode-usage-limits"
cd "$HOME/.local/share/opencode-usage-limits"
bun install
bun run build
```

For a public repository, you can instead clone over HTTPS without an SSH key:
`git clone https://github.com/sakateka/opencode-usage-limits.git "$HOME/.local/share/opencode-usage-limits"`.

Keep this checkout: OpenCode loads the plugin directly from it. Its root
`tui.ts` forwards to the locally built `dist/index.mjs`. The directory entrypoint
is required; a package's `./tui` export alone is not enough for local discovery.

### 2. Register the local plugin

Merge the following into `~/.config/opencode/cli.json`, preserving your existing
settings and other plugin entries. Replace `/home/YOU` with your actual home
directory (`/Users/YOU` on macOS). Use an **absolute path**, not a package name
or an unexpanded `~`.

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    { "package": "/home/YOU/.local/share/opencode-usage-limits" }
  ]
}
```

Do not use `"opencode-usage-limits"` or `"@sakateka/opencode-usage-limits"` here:
a bare package name triggers registry installation, not loading this checkout.
In particular, the unscoped name belongs to an unrelated npm package.

### 3. Configure the kimi.ai coding plan

Create `~/.config/opencode/usage-limits.jsonc` with the following configuration.
Only **Kimi Code global** is enabled; no Moonshot pay-as-you-go balance is queried.
The same example is available in [`examples/usage-limits.jsonc`](examples/usage-limits.jsonc).

```jsonc
{
  "enabled": true,
  "refreshIntervalSeconds": 60,
  "requestTimeoutMs": 10000,
  "showErrors": true,
  "providers": {
    "kimi": {
      "enabled": true,
      "label": "Kimi Code",
      "apiKey": "{env:KIMI_CODE_API_KEY}",
      "sidebarWindow": "all",
      "footerWindow": "auto"
    }
  }
}
```

Obtain a **Kimi Code subscription API key** from the
[Kimi Code console](https://www.kimi.com/code/console). The quota endpoint is
fixed at `https://api.kimi.ai/coding/v1/usages`; no `baseUrl` is needed or accepted.

Make `KIMI_CODE_API_KEY` available to the process running the **OpenCode TUI**.
For example, in **Bash**, this prompts without echoing the key or putting its
value in shell history:

```bash
read -r -s -p 'Kimi Code API key: ' KIMI_CODE_API_KEY
echo
export KIMI_CODE_API_KEY
opencode
```

Repeat the export in a new shell, or use your existing secret-management setup.
Do not commit real keys, auth files, or tokens to the repository, even a private one.

If the legacy `~/.local/share/opencode/auth.json` already contains a usable
`kimi-code-plan-global` entry, the plugin uses that before the environment
fallback. An explicit `authPath` takes precedence over both. A V2 account saved
only in OpenCode's SQLite database is **not** automatically read by this plugin;
use the environment fallback rather than editing or exporting the database.

### 4. Verify

Restart the TUI after installation. Run `/plugins`: the expected plugin ID is
**`sakateka.usage-limits`**, with a local source and no error. In an open session,
the sidebar should show **Kimi Code** with 5-hour and monthly quotas, including
reset times when the API provides them. The footer indicator appears for sessions
using the `kimi-code-plan-global` provider.

If the sidebar is hidden, use **Show sidebar** in the command palette and make
sure the terminal is wide enough. If the plugin is absent, check the absolute
path, root `tui.ts`, and `dist/index.mjs`. If it says `missing Kimi Code key`, check
the environment of the TUI process. A `401` means the quota API rejected the
selected credential; an old saved auth entry can take precedence over a new
environment key.

### Update

```sh
cd "$HOME/.local/share/opencode-usage-limits"
git pull --ff-only
bun install
bun run build
```

Restart the TUI to load the rebuilt plugin. No registry publication or background
server restart is required.

### Other providers

Add only the providers you need under `providers`:

```jsonc
"codex": { "enabled": true },
"zai": { "enabled": true },
"opencode-go": { "enabled": true }
```

Each needs its own working credential. Kimi credentials are never reused for
these providers.

## Development

```sh
bun install
bun run typecheck   # tsc --noEmit
bun run test        # vitest run (NODE_OPTIONS=--experimental-ffi for @opentui)
bun run build       # tsdown -> dist/
```

The existing test script runs Vitest on Node. UI tests need a Node version that
supports experimental FFI (`--experimental-ffi`, already set in the test script;
verified with Node 26). This is a development/test requirement, not an extra
runtime for the plugin inside OpenCode.

## Providers

| Provider | API | Windows | Credentials |
| --- | --- | --- | --- |
| `codex` | `https://chatgpt.com/backend-api/wham/usage` | primary, secondary, reset credits | OpenCode `openai` auth, `~/.codex/auth.json`, or config |
| `opencode-go` | `https://opencode.ai/zen/go/v1/usage` | rolling, weekly, monthly | OpenCode `opencode-go`/`opencode` auth or config |
| `zai` | `https://api.z.ai/api/monitor/usage/quota/limit` | 5h and weekly credits; legacy tokens | OpenCode `zai-coding-plan`/`zai` auth or config |
| `kimi` | `https://api.kimi.ai/coding/v1/usages` | 5h, monthly total, monthly code; legacy weekly | OpenCode `kimi-code-plan-global` auth or config |

### Kimi Code security and protocol notes

- This adapter is for the global Kimi Code subscription, not Moonshot API balance.
- The official [Kimi CLI usage implementation](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/ui/shell/usage.py)
  uses `GET <coding base URL>/usages` with Bearer authorization. The global base
  URL is documented in [Kimi Code API access](https://www.kimi.com/code/docs/en/#api-access).
- The supported global response fields `usages.limit_5h`, `limit_month_total`,
  and `limit_month_code` report `used_ratio` and `reset_time`.
  Prefer those precise ratios over rounded legacy `limits[].detail` counts.
- Credentials stay redacted until the HTTP boundary. There is no URL override,
  browser cookie access, subprocess, or automatic login. Requests use the shared
  bounded/interruptible HTTP client (2 MiB body limit and configured timeout),
  and redirects are rejected. Error bodies and credentials are not logged.
- The current shared credential loader reads legacy OpenCode `auth.json`, not
  the V2 credential database. If that entry is absent or stale, use an explicit
  `authPath` or `{env:NAME}` key fallback; no database migration is performed.

## License and upstream attribution

MIT. The original copyright and license notice are preserved in [LICENSE](LICENSE).

This is a reworked fork of
[`@mynameistito/opencode-usage-limits`](https://github.com/mynameistito/opencode-plugins/tree/main/packages/opencode-usage-limits),
based on version 1.3.3 (the source commit is recorded in `.upstream-commit`).
Much of the original UI, coordinator, configuration, provider runtime, and test
suite remains. This fork trims the provider set and subprocess support, adds
Kimi Code global subscription quotas, updates Z.AI credit-quota parsing, and
provides a local-directory entrypoint and GitHub installation instructions.
