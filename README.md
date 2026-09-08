# WebMind

A Plasmo browser extension that builds a human-like memory of the pages you
visit — capturing text **and images** — with a local sidecar server for
embeddings, a knowledge graph, and hybrid retrieval.

Inference runs locally through Ollama by default. LLaMA (text) and LLaVA (image
captioning) can **each** be switched to an AWS-hosted endpoint independently;
Nomic text embeddings **always** stay local.

## Setup

Run the setup script for your OS (installs tools, pulls Ollama models, installs
dependencies, initializes the database):

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

```bash
# macOS
chmod +x scripts/setup.sh && ./scripts/setup.sh
```

See [`scripts/README.md`](scripts/README.md) for flags, Linux notes, and the full
requirement list.

### Manual setup

```bash
# system: Node.js >= 18, Python 3, Ollama
ollama pull nomic-embed-text
ollama pull llava
ollama pull llama3.2:3b

# root extension deps (yarn if yarn.lock present, else npm)
yarn install

# sidecar deps + optional Python clustering deps + database
cd sidecar
npm install
python -m pip install -r requirements.txt   # optional (clustering only)
node init-schema.js
```

## Run

```bash
# terminal 1 — sidecar server (port 3001)
cd sidecar && node server.js

# terminal 2 — extension dev build
yarn dev
```

Then load the extension in Chrome: `chrome://extensions` → **Developer mode** →
**Load unpacked** → select `build/chrome-mv3-dev`.

Browse a few pages, then open <http://localhost:3001/graph> to see the knowledge
graph. Image nodes (pink thumbnails) appear under the **Images** toggle.

## Models

| Model | Used for | Local | Cloud |
|---|---|---|---|
| `nomic-embed-text` | text + image-caption embeddings | Ollama | **always local** |
| `llava` | captioning page images | Ollama | AWS `LLAVA_API_URL` when *Cloud LLaVA* is on |
| `llama3.2:3b` | memory reconstruction + cluster labels (`sidecar/config.json` → `llm_model`) | Ollama | AWS `LLAMA_API_URL` when *Cloud LLaMA* is on |

## Local vs. cloud inference

The pipeline is identical in both modes:

```
Webpage → extension → text + images
   ├── text     → LLaMA (local Ollama | AWS)  → synthesis / labels
   └── images   → LLaVA (local Ollama | AWS)  → caption
                              ↓
                     LOCAL Nomic embedding      ← always local
                              ↓
                       knowledge graph / DB
```

### Provider switches

The extension **Settings** tab has two independent toggles, persisted in
`sidecar/config.json` (`cloud_llama_enabled`, `cloud_llava_enabled`):

| Cloud LLaMA | Cloud LLaVA | LLaMA | LLaVA | Nomic |
|---|---|---|---|---|
| off | off | local | local | local |
| on  | off | AWS   | local | local |
| off | on  | local | AWS   | local |
| on  | on  | AWS   | AWS   | local |

The sidecar refuses to enable a switch unless its config is present, and
`/search` / `/health` surface a clear warning if it goes missing later.

### Environment variables

Only needed when a cloud switch is on. Put them in `.env` at the repo root
(git-ignored; the sidecar loads it on startup). See `.env.example`.

| Var | Meaning |
|---|---|
| `AWS_API_KEY` | **one** shared key for both endpoints (sent as `x-api-key`) |
| `LLAMA_API_URL` | LLaMA endpoint (OpenAI-compatible Chat Completions) |
| `LLAVA_API_URL` | LLaVA endpoint (OpenAI-compatible, vision message parts) |
| `AWS_LLAMA_MODEL` / `AWS_LLAVA_MODEL` | optional model-name overrides |
| `AWS_API_KEY_HEADER` | optional, default `x-api-key` |
| `AWS_TIMEOUT_MS` | optional, default `30000` |

The **same** `AWS_API_KEY` is used for both endpoints. The two endpoint URLs are
different. The key is only ever read by the sidecar (a local server) — it is
never bundled into the extension, shown in the UI, logged, or returned in an
error.

**AWS infrastructure is not created by this project.** Setup only records the
endpoint URLs + key you already have; it never deploys SageMaker, Lambda, or any
other AWS resource.

## Setup modes

`scripts/setup.sh` / `scripts/setup.ps1` ask which mode you want:

- **Local** — pulls `nomic-embed-text`, `llava`, `llama3.2:3b`.
- **Cloud** — pulls `nomic-embed-text` only, then prompts for `AWS_API_KEY`,
  `LLAMA_API_URL`, `LLAVA_API_URL` and writes them to `.env` (existing values are
  kept). Flags: `--local` / `--cloud` (`-Local` / `-Cloud` on PowerShell) skip
  the prompt.
