#!/usr/bin/env bash
#
# One-shot setup for the WebMind repository on macOS (Intel or Apple Silicon).
#
# Installs and verifies every prerequisite, then installs project dependencies:
#   - Git, Node.js LTS, Python 3          (via Homebrew)
#   - Ollama + models (local mode: nomic-embed-text, llava, llama3.2:3b;
#                      cloud mode: nomic-embed-text only)
#   - Root extension dependencies         (yarn or npm)
#   - sidecar/ Node dependencies          (npm)
#   - sidecar/ Python dependencies        (pip, optional - clustering only)
#   - Initializes sidecar/webmind.db
#
# This script does NOT deploy anything to AWS. Cloud mode only records the
# endpoint URLs + shared API key you already have into a local .env file.
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh [--local | --cloud] [--skip-models] [--skip-python]
#
set -euo pipefail

SKIP_MODELS=0
SKIP_PYTHON=0
MODE=""
for arg in "$@"; do
  case "$arg" in
    --skip-models) SKIP_MODELS=1 ;;
    --skip-python) SKIP_PYTHON=1 ;;
    --local) MODE="local" ;;
    --cloud) MODE="cloud" ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIDECAR="$REPO_ROOT/sidecar"
ENV_FILE="$REPO_ROOT/.env"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
c_cyan=$'\033[36m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_off=$'\033[0m'
info() { printf '%s==> %s%s\n' "$c_cyan"  "$1" "$c_off"; }
ok()   { printf '%s    %s%s\n' "$c_green" "$1" "$c_off"; }
warn() { printf '%s    %s%s\n' "$c_yellow" "$1" "$c_off"; }
die()  { printf '%s!!! %s%s\n' "$c_red"   "$1" "$c_off"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Set KEY=VALUE in $ENV_FILE. Never overwrites a key that already has a
# non-empty value (so re-running setup won't clobber your secrets).
upsert_env() {
  local key="$1" value="$2"
  [ -f "$ENV_FILE" ] || : > "$ENV_FILE"
  local existing
  existing="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ -n "$existing" ]; then
    warn "$key already set in .env - keeping existing value"
    return
  fi
  # remove any empty "KEY=" line, then append
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  ok "$key written to .env"
}

[ "$(uname -s)" = "Darwin" ] || die "This script targets macOS. On Linux install node, python3, git and ollama with your package manager, then run the dependency steps by hand."

# ---------------------------------------------------------------------------
# 0. inference mode
# ---------------------------------------------------------------------------
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    echo
    echo "How would you like to run AI inference?"
    echo "  1) Local only  - LLaMA + LLaVA + Nomic all via local Ollama"
    echo "  2) Cloud       - LLaMA + LLaVA via your AWS endpoints, Nomic stays local"
    printf "Choose [1/2] (default 1): "
    read -r choice || choice=""
    case "$choice" in
      2) MODE="cloud" ;;
      *) MODE="local" ;;
    esac
  else
    MODE="local"
  fi
fi
info "Inference mode: $MODE"

if [ "$MODE" = "cloud" ]; then
  OLLAMA_MODELS=(nomic-embed-text)
  info "Configuring AWS endpoints in $ENV_FILE (nothing is deployed to AWS)"
  [ -f "$ENV_FILE" ] || { [ -f "$REPO_ROOT/.env.example" ] && cp "$REPO_ROOT/.env.example" "$ENV_FILE"; }
  if [ -t 0 ]; then
    printf "  AWS_API_KEY (shared, leave blank to keep current): "; read -r v_key || v_key=""
    printf "  LLAMA_API_URL: "; read -r v_llama || v_llama=""
    printf "  LLAVA_API_URL: "; read -r v_llava || v_llava=""
    [ -n "$v_key" ]   && upsert_env AWS_API_KEY   "$v_key"
    [ -n "$v_llama" ] && upsert_env LLAMA_API_URL "$v_llama"
    [ -n "$v_llava" ] && upsert_env LLAVA_API_URL "$v_llava"
  else
    warn "non-interactive: edit $ENV_FILE and set AWS_API_KEY / LLAMA_API_URL / LLAVA_API_URL"
  fi
  warn "Enable the 'Cloud LLaMA' / 'Cloud LLaVA' switches in the extension settings to use them."
else
  OLLAMA_MODELS=(nomic-embed-text llava llama3.2:3b)
fi

# ---------------------------------------------------------------------------
# 1. Homebrew + system tools
# ---------------------------------------------------------------------------
info "Checking Homebrew"
if ! have brew; then
  info "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # make brew available in this shell (Apple Silicon vs Intel prefix)
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
have brew || die "Homebrew install did not complete. Open a new terminal and re-run."
ok "$(brew --version | head -1)"

info "Checking system tools"
brew_install() { info "brew install $1"; brew install "$1"; }

have git     && ok "git    $(git --version)"              || brew_install git
have node    && ok "node   $(node --version)"             || brew_install node
have npm     && ok "npm    $(npm --version)"              || die "npm missing after node install."
have python3 && ok "python $(python3 --version 2>&1)"     || brew_install python
have ollama  && ok "ollama $(ollama --version 2>&1 | head -1)" || brew_install ollama

# node version guard (need >= 18 for global fetch)
node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "${node_major:-0}" -lt 18 ]; then
  die "Node.js $node_major detected; WebMind needs Node 18 or newer (20 LTS recommended)."
fi

# ---------------------------------------------------------------------------
# 2. ollama service + models
# ---------------------------------------------------------------------------
info "Ensuring the Ollama service is running"
ollama_up() { ollama list >/dev/null 2>&1; }

if ! ollama_up; then
  if brew services start ollama >/dev/null 2>&1; then
    :
  else
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  fi
  for _ in $(seq 1 20); do ollama_up && break || sleep 1; done
fi
if ollama_up; then ok "Ollama is responding"; else warn "Ollama did not come up - start it with 'ollama serve' and re-run the model pulls."; fi

if [ "$SKIP_MODELS" -eq 1 ]; then
  warn "--skip-models set: not pulling ${OLLAMA_MODELS[*]}"
elif ollama_up; then
  installed="$(ollama list 2>/dev/null || true)"
  for m in "${OLLAMA_MODELS[@]}"; do
    if printf '%s' "$installed" | grep -q -- "$m"; then
      ok "model present: $m"
    else
      info "Pulling model: $m  (this can be several GB)"
      ollama pull "$m"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 3. JavaScript dependencies
# ---------------------------------------------------------------------------
info "Installing root extension dependencies"
pushd "$REPO_ROOT" >/dev/null
if have yarn; then
  yarn install --frozen-lockfile
elif [ -f "$REPO_ROOT/yarn.lock" ]; then
  info "yarn.lock present but yarn missing - enabling via corepack"
  if corepack enable >/dev/null 2>&1 && yarn install --frozen-lockfile; then :; else
    warn "corepack/yarn unavailable - falling back to npm install"; npm install
  fi
else
  npm install
fi
popd >/dev/null
ok "root dependencies installed"

info "Installing sidecar dependencies"
pushd "$SIDECAR" >/dev/null
if [ -f "$SIDECAR/package-lock.json" ]; then npm ci; else npm install; fi
popd >/dev/null
ok "sidecar dependencies installed"

# ---------------------------------------------------------------------------
# 4. Python dependencies (optional - HDBSCAN clustering only)
# ---------------------------------------------------------------------------
if [ "$SKIP_PYTHON" -eq 1 ]; then
  warn "--skip-python set: skipping clustering dependencies"
elif have python3; then
  info "Installing Python clustering dependencies"
  req="$SIDECAR/requirements.txt"
  if python3 -m pip install --upgrade pip >/dev/null 2>&1 && python3 -m pip install -r "$req"; then
    ok "Python dependencies installed"
  elif python3 -m pip install --user -r "$req"; then
    ok "Python dependencies installed (--user)"
  elif python3 -m pip install --break-system-packages -r "$req"; then
    ok "Python dependencies installed (--break-system-packages)"
  else
    warn "Python dependency install failed. Clustering will be unavailable; the rest of WebMind still runs."
    warn "Retry manually:  python3 -m pip install -r sidecar/requirements.txt"
  fi
else
  warn "python3 not found - skipping clustering dependencies."
fi

# ---------------------------------------------------------------------------
# 5. database
# ---------------------------------------------------------------------------
info "Initializing sidecar database (sidecar/webmind.db)"
pushd "$SIDECAR" >/dev/null
node init-schema.js
popd >/dev/null
ok "database ready"

# ---------------------------------------------------------------------------
# done
# ---------------------------------------------------------------------------
echo
info "Setup complete. Next steps:"
cat <<EOF
    1. Start the sidecar server:
         cd sidecar
         node server.js

    2. In a second terminal, build the extension:
         yarn dev            (or: npm run dev)

    3. Load it in Chrome:
         chrome://extensions  ->  Developer mode  ->  Load unpacked
         select:  $REPO_ROOT/build/chrome-mv3-dev

    4. Browse an image-heavy page, then open  http://localhost:3001/graph
EOF
