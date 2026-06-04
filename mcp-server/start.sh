#!/usr/bin/env bash
# macOS / Linux / Git Bash. On Windows use: npm run dev  (start.ps1)
set -euo pipefail

cd "$(dirname "$0")"

CHROMA_HOST="${CHROMA_HOST:-localhost}"
CHROMA_PORT="${CHROMA_PORT:-8000}"
OLLAMA_HOST="${OLLAMA_HOST:-localhost}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
CHROMA_CONTAINER="${CHROMA_CONTAINER:-chroma}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"

if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

now_ms() {
  echo $(($(date +%s) * 1000))
}

log() {
  local level="$1"
  local msg="$2"
  local level_num=30
  case "$level" in
    debug) level_num=20 ;;
    info)  level_num=30 ;;
    warn)  level_num=40 ;;
    error) level_num=50 ;;
  esac
  # shellcheck disable=SC2059
  printf '{"level":%s,"time":%s,"pid":%s,"hostname":"%s","name":"github-pr-agent-startup","msg":"%s"}\n' \
    "$level_num" "$(now_ms)" "$$" "$(hostname 2>/dev/null || echo localhost)" "$msg" >&2
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local i=1
  while [ "$i" -le "$WAIT_SECONDS" ]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      log info "$label is ready ($url)"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  log error "$label did not become ready within ${WAIT_SECONDS}s ($url)"
  return 1
}

port_open() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" 2>/dev/null
    return $?
  fi
  curl -sf "http://${host}:${port}/" >/dev/null 2>&1
}

# --- ChromaDB ---
log info "Checking ChromaDB on ${CHROMA_HOST}:${CHROMA_PORT}"

if port_open "$CHROMA_HOST" "$CHROMA_PORT"; then
  log info "ChromaDB already reachable, skipping Docker start"
else
  if ! command -v docker >/dev/null 2>&1; then
    log error "docker not found; install Docker or start Chroma manually"
    exit 1
  fi

  if docker ps --format '{{.Names}}' | grep -qx "$CHROMA_CONTAINER"; then
    log info "Chroma container already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$CHROMA_CONTAINER"; then
    log info "Starting existing Chroma container"
    docker start "$CHROMA_CONTAINER" >/dev/null
  else
    log info "Creating Chroma container ($CHROMA_CONTAINER)"
    docker run -d --name "$CHROMA_CONTAINER" -p "${CHROMA_PORT}:8000" chromadb/chroma >/dev/null
  fi

  wait_for_http "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat" "ChromaDB" \
    || wait_for_http "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v1/heartbeat" "ChromaDB" \
    || wait_for_http "http://${CHROMA_HOST}:${CHROMA_PORT}/" "ChromaDB"
fi

# --- Ollama ---
log info "Checking Ollama on ${OLLAMA_HOST}:${OLLAMA_PORT}"

OLLAMA_PID=""
if port_open "$OLLAMA_HOST" "$OLLAMA_PORT"; then
  log info "Ollama already reachable, skipping ollama serve"
else
  if ! command -v ollama >/dev/null 2>&1; then
    log error "ollama not found; install from https://ollama.com"
    exit 1
  fi
  log info "Starting ollama serve in background"
  ollama serve >/dev/null 2>&1 &
  OLLAMA_PID=$!
  wait_for_http "http://${OLLAMA_HOST}:${OLLAMA_PORT}/" "Ollama"
fi

# --- Embedding model ---
log info "Checking Ollama model ${OLLAMA_EMBED_MODEL}"

if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$OLLAMA_EMBED_MODEL"; then
  log info "Model ${OLLAMA_EMBED_MODEL} already present"
else
  log info "Pulling ${OLLAMA_EMBED_MODEL}"
  ollama pull "$OLLAMA_EMBED_MODEL"
  log info "Model ${OLLAMA_EMBED_MODEL} pull complete"
fi

# --- MCP server ---
log info "Starting MCP server"
exec npx tsx src/index.ts
