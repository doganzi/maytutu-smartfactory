#!/usr/bin/env bash
# Local dev preview for maytutu-smartfactory (static PWA + Google Sheets).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
echo "[maytutu-smartfactory] static PWA preview"
echo "  serving:  $(pwd)"
echo "  url:      http://localhost:${PORT}/"
echo
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
