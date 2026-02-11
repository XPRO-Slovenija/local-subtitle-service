# localSubtitleService

Local HTTP service to accept a long video (~2.5h+), extract audio to mono 128 kbps MP3 via ffmpeg, and forward it to Speech7 for subtitle generation.

## Quick start

```bash
npm install
cp .env .env.local  # edit your API key, optional paths
PORT=4000 SPEECH7_API_KEY=your_key npm run start
```

Dev mode with auto-reload:

```bash
SPEECH7_API_KEY=your_key npm run dev
```

Make sure the sibling `speech7` service is running on https://app.speech7.com.

## API

- `GET /health` – sanity check.
- `POST /subtitle` – multipart/form-data with field `video` (file). Streams video to disk, transcodes to mono 128k MP3, sends to Speech7 `/subtitle/jobs`, returns their JSON plus a `token` convenience field (`token/id/jobId/requestId/uploadToken`), `statusUrl`, and `downloadUrl` helpers.
- `GET /subtitle/:token` – proxies Speech7 job status for that token; returns processing info (queued/processing/completed).
- `GET /subtitle/:token/file` – streams the subtitle file from Speech7 when available.

### Notes

- Default limits allow videos up to 20 GB (adjust in `src/server.js`).
- Temp dirs: `tmp/uploads` for incoming, `tmp/audio` for mp3; configurable via env (`UPLOAD_DIR`, `AUDIO_DIR`, `TMP_DIR`).
- Uses `ffmpeg` from PATH; override with `FFMPEG_PATH`.
- Speech7 base defaults to `speech7` project on https://app.speech7.com.
- Speech7 config via env: `SPEECH7_BASE_URL` (default `https://app.speech7.com` to hit the speech7 project), `SPEECH7_JOBS_PATH` (default `/subtitle/jobs`), optional `SPEECH7_JOBS_URL` / `SPEECH7_STATUS_BASE_URL` overrides, `SPEECH7_DOWNLOAD_SUFFIX` (default `file`), `SPEECH7_UPLOAD_FIELD` (default `audio`), `SPEECH7_API_KEY`, `SPEECH7_LANGUAGE`, `SPEECH7_AUTH_HEADER` (e.g. `Authorization`), optional `SPEECH7_AUTH_PREFIX` (e.g. `Bearer `), optional `SPEECH7_KEY_QUERY_PARAM` if the API expects the key as a query param instead of a header.

## What happens

1. Upload saved to disk (Multer).
2. ffmpeg strips video, resamples to 44.1kHz mono, 128k bitrate.
3. Audio posted as multipart to Speech7 with API key header.
4. Temp files cleaned after request.

## Example request

```bash
curl -X POST http://localhost:4000/subtitle \
  -H "x-api-key: $SPEECH7_API_KEY" \
  -F "video=@/path/to/video.mp4"
```

Poll:

```bash
curl -X GET "http://localhost:4000/subtitle/$TOKEN" -H "x-api-key: $SPEECH7_API_KEY"
```

Download when ready:

```bash
curl -L -X GET "http://localhost:4000/subtitle/$TOKEN/file" -H "x-api-key: $SPEECH7_API_KEY" -o subtitles.srt
```

## Binaries (single-file builds)

We ship self-contained binaries per platform. Place a `.env` next to the binary (or export vars). Ensure `ffmpeg` is installed or put `ffmpeg`/`ffmpeg.exe` alongside the binary (or set `FFMPEG_PATH`). Writable temp dirs may be set via `TMP_DIR`, `UPLOAD_DIR`, `AUDIO_DIR`.

- **macOS arm64**: `dist/lss-macos-arm64`
- **macOS x64**: `dist/lss-macos-x64`
- **Linux arm64**: `dist/lss-linux-arm64` (if your CPU is older/segfaults, use the SEA-built `dist/lss-linux-arm64` generated via instructions below)
- **Linux x64**: `dist/lss-linux-x64`
- **Windows x64**: `dist/lss-windows-x64.exe`
- **Windows arm64**: build via pkg/SEA (see below)

Run examples:

```bash
# macOS / Linux
chmod +x dist/lss-macos-arm64   # or lss-macos-x64 / lss-linux-*
./dist/lss-macos-arm64

# Windows
dist\lss-windows-x64.exe
```

If `ffmpeg` is not on PATH, set `FFMPEG_PATH` to its location, e.g. `FFMPEG_PATH=/usr/bin/ffmpeg` or `FFMPEG_PATH=.\ffmpeg.exe`.

### How to build the executables

Prereqs: Node 18+, `npm install`, and `ffmpeg` available on your build machine.

#### One-command build (all targets + SEA helper)

```bash
scripts/build-binaries.sh
```

Produces pkg binaries for macOS (x64/arm64), Linux (x64/arm64), Windows (x64) and, if `postject` is installed, a SEA-based `dist/lss-linux-arm64` for older ARM CPUs.

WARNING: linux arm64 doesn't work; you need to run the project with node:
sudo apt update
sudo apt install ffmpeg
npm install
node src/server.js

#### SEA (most compatible on Linux arm64)

Use Node’s Single Executable Application flow on an arm64 host (Node 20+):

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm ci
npm install -D postject

cat > sea-config.json <<'EOF'
{
  "main": "./src/server.js",
  "output": "./dist/sea-prep.blob",
  "useSnapshot": true
}
EOF

mkdir -p dist
node --experimental-sea-config sea-config.json
cp "$(command -v node)" dist/lss-linux-arm64
npx postject dist/lss-linux-arm64 NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_BLOB
chmod +x dist/lss-linux-arm64
strip dist/lss-linux-arm64 || true
```

Pick the binary you need from `dist/` and ship it with a `.env` file.

### Building a Linux arm64 SEA binary (most compatible on aarch64)

On an arm64 host (Ubuntu):

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /path/to/localSubtitleService
npm ci
npm install -D postject

cat > sea-config.json <<'EOF'
{
  "main": "./src/server.js",
  "output": "./dist/sea-prep.blob",
  "useSnapshot": true
}
EOF

mkdir -p dist
node --experimental-sea-config sea-config.json
cp "$(command -v node)" dist/lss-linux-arm64
npx postject dist/lss-linux-arm64 NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_BLOB
chmod +x dist/lss-linux-arm64
strip dist/lss-linux-arm64 || true
```

Then run `dist/lss-linux-arm64` with your `.env` present.

## Troubleshooting

- ffmpeg errors: check stderr in response `details`, or run ffmpeg manually with same args from `src/ffmpeg.js`.
- HTTP 4xx from Speech7: verify API key header name matches `SPEECH7_AUTH_HEADER` and URL.
- Large uploads: ensure disk space in `TMP_DIR`; increase `multer` `fileSize` limit if needed.

### Passing API key per request

- You can skip setting `SPEECH7_API_KEY` in env and instead send the key with each request via `x-api-key` header (or whatever `SPEECH7_AUTH_HEADER` is set to). You can also supply it as a form field `apiKey` or query string `?apiKey=...`. The service picks request-provided keys first, then falls back to env.

### Polling for result

- After a successful upload you receive a `token` and helper URLs. Poll `GET /subtitle/:token` with the same API key header until status becomes `completed`, then download via `GET /subtitle/:token/file` (or use the `downloadUrl` from Speech7).
- If Speech7 returns relative URLs, the service will prefix them with `SPEECH7_STATUS_BASE_URL`. You can override with `?statusUrl=` or `?downloadUrl=` on the GET routes if needed.
