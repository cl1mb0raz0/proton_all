#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[[ -f .env ]] || { echo "No .env yet: cp .env.example .env and set PDRIVE_DATA_DIR in it." >&2; exit 1; }

docker compose up -d --build

url=""
for _ in $(seq 1 30); do
  url=$(docker compose logs --no-log-prefix pdrive 2>/dev/null \
        | grep -o 'http://127\.0\.0\.1:[0-9]*/?k=[^ ]*' | tail -1 || true)
  [[ -n "$url" ]] && break
  sleep 1
done
[[ -n "$url" ]] || { echo "The link did not appear: docker compose logs pdrive" >&2; exit 1; }

echo "Open: $url"
if command -v xdg-open >/dev/null; then
  xdg-open "$url" >/dev/null 2>&1 || true
fi
