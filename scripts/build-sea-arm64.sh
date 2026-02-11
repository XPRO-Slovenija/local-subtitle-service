#!/usr/bin/env bash
set -euo pipefail

# Build a Linux arm64 SEA single binary on an aarch64 host (Ubuntu/debian-like).
# Requires Node 20+ (SEA flag added in 20).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT_DIR/dist"
BLOB="$DIST/sea-prep.blob"
BIN="$DIST/lss-linux-arm64"

mkdir -p "$DIST"
cd "$ROOT_DIR"

# Ensure deps are present (needed for mksnapshot)
npm ci

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "SEA build requires Node 20+. Current: $(node -v 2>/dev/null || echo none). Install Node 20 (e.g., nodesource setup_20.x) and retry." >&2
  exit 1
fi

cat > sea-config.json <<'JSON'
{
  "main": "./src/server.js",
  "output": "./dist/sea-prep.blob",
  "useSnapshot": true
}
JSON

node --experimental-sea-config sea-config.json
cp "$(command -v node)" "$BIN"
npx postject "$BIN" NODE_SEA_BLOB "$BLOB" --sentinel-fuse NODE_SEA_BLOB
chmod +x "$BIN"
strip "$BIN" 2>/dev/null || true

echo "Built $BIN"
