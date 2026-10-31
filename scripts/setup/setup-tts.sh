#!/usr/bin/env bash
#
# Local AI Studio - Kokoro TTS setup for Linux/macOS
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$APP_DIR/tools"
PLATFORM="$(uname -s)"

if [[ "$PLATFORM" == "Darwin" ]]; then
  NODE_DIR="$TOOLS_DIR/node-mac"
else
  NODE_DIR="$TOOLS_DIR/node-linux"
fi

NODE_BIN="$NODE_DIR/bin/node"
NPM_BIN="$NODE_DIR/bin/npm"
RUNTIME_DIR="$APP_DIR/tts-runtime"
MODELS_DIR="$APP_DIR/tts-models"
OUTPUTS_DIR="$APP_DIR/tts-outputs"
CACHE_DIR="$APP_DIR/tts-cache"

print_ok() { echo "   OK   $1"; }
print_info() { echo "   >>   $1"; }
print_fail() { echo "   XX   $1"; }

supports_symlinks() {
  local dir="$1"
  local test_target="$dir/.symlink-test-target"
  local test_link="$dir/.symlink-test-link"

  rm -f "$test_target" "$test_link"
  : > "$test_target"
  if ln -s ".symlink-test-target" "$test_link" 2>/dev/null; then
    rm -f "$test_target" "$test_link"
    return 0
  fi

  rm -f "$test_target" "$test_link"
  return 1
}

echo ""
echo "  ============================================================"
echo "   Setting up Kokoro ONNX Text-to-Speech runtime"
echo "  ============================================================"
echo ""

mkdir -p "$RUNTIME_DIR" "$MODELS_DIR" "$OUTPUTS_DIR" "$CACHE_DIR"

if [[ ! -x "$NODE_BIN" || ! -x "$NPM_BIN" ]]; then
  print_fail "Portable Node.js is missing. Run scripts/setup/setup.sh first."
  exit 1
fi

if [[ ! -f "$RUNTIME_DIR/package.json" ]] || ! grep -q "node-addon-api" "$RUNTIME_DIR/package.json"; then
  cat > "$RUNTIME_DIR/package.json" <<'JSON'
{"private":true,"type":"module","dependencies":{"kokoro-js":"^1.2.1","node-addon-api":"^7.1.1","node-gyp":"^10.0.0"}}
JSON
  rm -f "$RUNTIME_DIR/package-lock.json"
fi

cd "$RUNTIME_DIR"
export PATH="$NODE_DIR/bin:$PATH"
# Kokoro runs on CPU. Avoid ONNX Runtime's optional CUDA payload, which can
# fail installation when nvcc reports a newer toolkit such as CUDA 13.
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
if [[ -f "$RUNTIME_DIR/package-lock.json" ]]; then
  NPM_INSTALL_MODE="ci"
else
  NPM_INSTALL_MODE="install"
fi
print_info "Installing pinned kokoro-js dependencies into app/tts-runtime..."
if supports_symlinks "$RUNTIME_DIR"; then
  "$NPM_BIN" "$NPM_INSTALL_MODE" --prefer-online --no-audit --no-fund
else
  print_info "Filesystem does not support symlinks; installing without npm bin links..."
  "$NPM_BIN" "$NPM_INSTALL_MODE" --prefer-online --no-audit --no-fund --no-bin-links
fi

print_ok "Kokoro TTS runtime is ready."
