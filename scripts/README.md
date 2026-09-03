# Setup scripts

One-shot environment setup for WebMind. Each script installs the system tools,
pulls the required Ollama models, installs JS + Python dependencies, and
initializes `sidecar/webmind.db`.

## Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Uses **winget** to install Git, Node.js LTS, Python 3 and Ollama. If a tool was
just installed and a later step can't find it, close and reopen PowerShell, then
re-run — the script is idempotent.

Flags: `-SkipModels` (skip the large Ollama downloads), `-SkipPython` (skip the
clustering dependencies).

## macOS (bash)

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Uses **Homebrew** (installs it if missing) for node, python, git and ollama.

Flags: `--skip-models`, `--skip-python`.

## What gets installed

| Requirement | Purpose |
|---|---|
| Node.js ≥ 18 (20 LTS recommended) | extension build + sidecar server |
| Python 3 + `hdbscan`, `numpy`, `scikit-learn` | HDBSCAN clustering (optional — server runs without it) |
| Ollama | local inference |
| `nomic-embed-text` | text + image-caption embeddings (768-d) |
| `llava` | vision model that captions page images |
| `llama3.2:3b` | memory reconstruction LLM (`sidecar/config.json` → `llm_model`) |
| root `node_modules` | Plasmo extension deps (yarn if `yarn.lock`, else npm) |
| `sidecar/node_modules` | express, LanceDB, sqlite3, graphology, ollama |

## Linux

No dedicated script. Install `node`, `python3`, `git` and `ollama` with your
package manager, then run the dependency steps from `setup.sh` by hand
(the `ollama pull`, `yarn/npm install`, `pip install`, `node init-schema.js` blocks).
