#!/usr/bin/env bash
set -euo pipefail

BASE="${RT_REFRESH_BASE:-}"
BASIC_AUTH="${RT_REFRESH_BASIC_AUTH:-}"
RAW="${RT_REFRESH_RAW:-}"
PROXY_TARGET="${RT_REFRESH_PROXY_TARGET:-}"
REF="${RT_REFRESH_REF:-main}"
REPO="${RT_REFRESH_REPO:-https://raw.githubusercontent.com/zhizhishu/rt-refresh}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --basic-auth) BASIC_AUTH="${2:-}"; shift 2 ;;
    --raw|--no-redact) RAW="1"; shift ;;
    --proxy-target) PROXY_TARGET="${2:-}"; shift 2 ;;
    --ref) REF="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$BASE" ]; then
  echo "Missing --base, e.g. --base http://SERVER:8787" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rt-refresh-probe.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT INT TERM

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    echo "Need curl or wget" >&2
    exit 2
  fi
}

node_major() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

get_node() {
  if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; then
    command -v node
    return
  fi

  local os arch platform index version archive url node_dir
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux) platform="linux" ;;
    Darwin) platform="darwin" ;;
    *) echo "Unsupported OS for portable Node auto-download: $os" >&2; exit 2 ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported arch for portable Node auto-download: $arch" >&2; exit 2 ;;
  esac

  index="$TMP_ROOT/node-index.json"
  download "https://nodejs.org/dist/index.json" "$index"
  version="$(grep -o '"version":"v24[^"]*' "$index" | head -n 1 | cut -d '"' -f 4)"
  if [ -z "$version" ]; then
    version="$(grep -o '"version":"v[0-9][^"]*' "$index" | head -n 1 | cut -d '"' -f 4)"
  fi
  if [ -z "$version" ]; then
    echo "Cannot resolve portable Node.js version" >&2
    exit 2
  fi

  node_dir="node-$version-$platform-$arch"
  archive="$TMP_ROOT/$node_dir.tar.xz"
  url="https://nodejs.org/dist/$version/$node_dir.tar.xz"
  download "$url" "$archive"
  tar -xJf "$archive" -C "$TMP_ROOT"
  echo "$TMP_ROOT/$node_dir/bin/node"
}

SCRIPT_BASE="$REPO/$REF/scripts"
download "$SCRIPT_BASE/quick-probe.mjs" "$TMP_ROOT/quick-probe.mjs"
download "$SCRIPT_BASE/cli-companion.mjs" "$TMP_ROOT/cli-companion.mjs"

NODE_BIN="$(get_node)"
ARGS=("$TMP_ROOT/quick-probe.mjs" "--base" "$BASE")
if [ -n "$BASIC_AUTH" ]; then ARGS+=("--basic-auth" "$BASIC_AUTH"); fi
if [ -n "$RAW" ]; then ARGS+=("--raw"); fi
if [ -n "$PROXY_TARGET" ]; then ARGS+=("--proxy-target" "$PROXY_TARGET"); fi

"$NODE_BIN" "${ARGS[@]}"
