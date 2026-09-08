# Setup scripts

One-shot environment setup for WebMind. Each script installs the system tools,
pulls the required Ollama models, installs JS + Python dependencies, and
initializes `sidecar/webmind.db`.

Each script first asks how you want to run inference:

- **Local** — pulls `nomic-embed-text`, `llava`, `llama3.2:3b`.
- **Cloud** — pulls `nomic-embed-text` only (Nomic always stays local), then
  prompts for `AWS_API_KEY`, `LLAMA_API_URL`, `LLAVA_API_URL` and writes them to
  `.env` at the repo root. Existing non-empty values are never overwritten.
  **Nothing is deployed to AWS** — the endpoints must already exist.

Skip the prompt with `--local` / `--cloud` (bash) or `-Local` / `-Cloud`
(PowerShell).

## Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Uses **winget** to install Git, Node.js LTS, Python 3 and Ollama. If a tool was
just installed and a later step can't find it, close and reopen PowerShell, then
re-run — the script is idempotent.

Flags: `-Local` / `-Cloud` (pick inference mode non-interactively),
`-SkipModels` (skip the large Ollama downloads), `-SkipPython` (skip the
clustering dependencies).

## macOS (bash)

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Uses **Homebrew** (installs it if missing) for node, python, git and ollama.

Flags: `--local` / `--cloud`, `--skip-models`, `--skip-python`.

## What gets installed

| Requirement | Purpose |
|---|---|
| Node.js ≥ 18 (20 LTS recommended) | extension build + sidecar server |
| Python 3 + `hdbscan`, `numpy`, `scikit-learn` | HDBSCAN clustering (optional — server runs without it) |
| Ollama | local inference |
| `nomic-embed-text` | text + image-caption embeddings (768-d) — always local |
| `llava` | vision model that captions page images (local mode only) |
| `llama3.2:3b` | memory reconstruction LLM (local mode only; `sidecar/config.json` → `llm_model`) |
| root `node_modules` | Plasmo extension deps (yarn if `yarn.lock`, else npm) |
| `sidecar/node_modules` | express, LanceDB, sqlite3, graphology, ollama |

## Linux

No dedicated script. Install `node`, `python3`, `git` and `ollama` with your
package manager, then run the dependency steps from `setup.sh` by hand
(the `ollama pull`, `yarn/npm install`, `pip install`, `node init-schema.js` blocks).
