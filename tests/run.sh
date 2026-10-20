#!/usr/bin/env bash
# tests/run.sh - Syntax Checks And The Test Suite, Run Inside The Docker Image.
# Needs Only Docker. The Proton Login Is Faked And Your Drive Is Never Touched.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose build -q
docker run --rm -v "$PWD":/src:ro -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  -e REAL_RCLONE=/usr/local/bin/rclone --entrypoint bash pdrive:latest -c '
set -euo pipefail
for f in pdrive pdrive-selftest up.sh docker/entrypoint.sh tests/fake_rclone; do bash -n "$f" && echo "ok  $f"; done
python3 -c "import ast; ast.parse(open(\"pdrive-web\").read())" && echo "ok  pdrive-web"
python3 -m unittest discover -s tests -v 2>&1
'
