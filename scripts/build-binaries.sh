#!/usr/bin/env bash
set -euo pipefail

# Build all single-file executables in one go.
# - pkg multi-target (macOS/Linux/Windows x64/arm64) using Node 18 runtimes
# - SEA build for Linux arm64 (best compatibility on aarch64 hosts)
# Prereqs: Node 18+, npm install, pkg (dev dep), postject (for SEA), ffmpeg available on PATH for runtime.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT_DIR/dist"
SEA_BLOB="$DIST/sea-prep.blob"
SEA_BIN="$DIST/lss-linux-arm64"

mkdir -p "$DIST"
cd "$ROOT_DIR"

# Ensure deps installed
if [ ! -d node_modules ]; then
  npm ci
fi

# 1) pkg multi-target build
HOST_ARCH=$(uname -m)
PKG_TARGETS="node18-macos-x64,node18-macos-arm64,node18-linux-x64,node18-win-x64"
# Only cross-build linux arm64 via pkg when not on aarch64 host (pkg arm64 runtime can be finicky);
# when on aarch64, we build a native SEA binary instead.
if [ "$HOST_ARCH" != "aarch64" ] && [ "$HOST_ARCH" != "arm64" ]; then
  PKG_TARGETS="$PKG_TARGETS,node18-linux-arm64"
fi
npx pkg --targets "$PKG_TARGETS" --output "$DIST/lss" .

# 2) SEA arm64 build (best compatibility on aarch64)
if command -v postject >/dev/null 2>&1; then
  cat > sea-config.json <<'JSON'
{
  "main": "./src/server.js",
  "output": "./dist/sea-prep.blob",
  "useSnapshot": true
}
JSON
  node --experimental-sea-config sea-config.json
  cp "$(command -v node)" "$SEA_BIN"
  npx postject "$SEA_BIN" NODE_SEA_BLOB "$SEA_BLOB" --sentinel-fuse NODE_SEA_BLOB
  chmod +x "$SEA_BIN"
  strip "$SEA_BIN" 2>/dev/null || true
else
  echo "postject not installed; skipping SEA arm64 build (npm i -D postject to enable)" >&2
fi

echo "\nBuilt binaries in $DIST:" && ls -1 "$DIST"
