# Star Manager

[中文文档 (Simplified Chinese)](./README.zh-CN.md)

Star Manager is a local-first web app for organizing GitHub starred repositories with Star Lists and optional LLM-assisted classification.

## Why Star Manager

If you have hundreds of starred repositories, manual list management is slow and inconsistent. Star Manager helps you:

- Sync your starred repositories and Star Lists from GitHub.
- Classify repositories in batches with an OpenAI-compatible LLM.
- Review diffs before any write-back.
- Apply updates to GitHub with explicit progress and issue reporting.
- Keep your working data in browser local storage (IndexedDB via Dexie).

## Key Capabilities

- GitHub sync with progress:
  - Fetches starred repositories and Star Lists.
  - Scans list memberships.
  - Supports retry for failed list membership scans.
- Classification pipeline:
  - Two-stage tagging (repo tagging + tag compression).
  - Test mode (small sample) and strict single-tag mode.
  - Diff view against existing Star Lists or a previous classification run.
- Write-back workflow:
  - Preview planned changes (`Current` vs `After`) before apply.
  - Creates missing lists when needed during apply.
  - Optional re-plan before apply.
  - Confirms behavior for repos not currently starred.
- Local editing:
  - Assign list memberships per repo in UI before write-back.
- i18n:
  - English/Chinese UI with browser language auto-detection and manual override.

## Prerequisites

- Node.js 20+ (LTS recommended)
- `pnpm`
- A GitHub Personal Access Token (PAT)
- Optional: an OpenAI-compatible LLM endpoint for classification

## Quick Start

```bash
pnpm install
pnpm dev
```

Build and preview:

```bash
pnpm build
pnpm preview
```

## Configuration

### 1) GitHub PAT

In the app:

1. Open `Settings` or `Connect PAT`.
2. Paste your token.
3. Validate and save.

The token must be able to read your starred repositories and access Star Lists operations for your account. If validation fails, check token scopes/permissions and account feature availability.

### 2) LLM (Optional)

In `Settings -> LLM Configuration`, set:

- `baseUrl` (default: `https://api.openai.com/v1`)
- `apiKey`
- `model` (default: `gpt-4o-mini`)
- `temperature`
- `maxTokens`

You can run classification without changing prompts, or customize prompts for:

- default tagging mode
- strict single-tag mode
- existing-list constrained modes
- English/Chinese prompt variants

## Typical Workflow

1. Connect PAT.
2. Click `Sync Star Lists`.
3. (Optional) Retry failed list membership scans from the status panel.
4. Open `Run Classification` and run LLM classification.
5. Review preview and diffs.
6. Open `Apply Updates` to preview planned GitHub changes.
7. Apply updates to GitHub.

## Project Structure

```text
src/app/
  App.tsx                 # Main UI shell
  core/                   # Use-cases and orchestration
  services/               # GitHub + LLM clients
  data/                   # Dexie DB and reactive query helpers
  store/                  # Local preferences and LLM config stores
  ui/                     # UI components and modals
  i18n/                   # Translation resources and language helpers
  styles/                 # CSS styles
```

## Data & Privacy

- Local-first storage:
  - App data is stored in browser IndexedDB (`star-manager` database).
  - Preferences and LLM config are stored in browser local storage.
- PAT and LLM API key are stored locally in your browser.
- The app calls GitHub and your configured LLM endpoint directly from the client.
- Sensitive values should not be logged; avoid sharing browser storage exports.

## Troubleshooting

- `Star Lists API not available for this token/account`
  - Your account or token may not have access to Star Lists GraphQL fields.
- PAT validation failed
  - Re-check token value and permissions; regenerate token if needed.
- LLM test/classification fails
  - Verify `baseUrl`, `apiKey`, `model`, and endpoint compatibility with `/chat/completions`.
- No repos shown after sync
  - Confirm your account has starred repositories and sync completed successfully.

## Known Limitations & Roadmap

Planned next steps include:

- Incremental sync strategy to reduce repeated work.
- Better rate-limit handling and failure recovery.
- Clearer error attribution (permission/token/network categories).
- README cache policy implementation (`ETag/hash` and truncation strategy).
- Future quality scripts (`lint`/`test`) are not configured yet.

## Contributing

Contributions are welcome. For substantial changes, open an issue first to discuss scope.

Local commands:

```bash
pnpm dev
pnpm build
pnpm preview
```

## License

No `LICENSE` file is published yet.
Until a license is added, redistribution and commercial use terms are not explicitly granted.
