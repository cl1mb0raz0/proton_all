#!/usr/bin/env bash
# tests/run.sh - Syntax Checks And The Test Suite.
# Usage:  tests/run.sh        (REAL_RCLONE=/path/to/rclone If It Is Not On PATH)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

for f in pdrive pdrive-selftest install.sh export-bundle.sh up.sh docker/entrypoint.sh tests/fake_rclone; do
  bash -n "$f" && echo "ok  $f"
done
python3 -m py_compile pdrive-web && echo "ok  pdrive-web"
if command -v shellcheck >/dev/null; then
  shellcheck -S warning pdrive pdrive-selftest install.sh export-bundle.sh up.sh docker/entrypoint.sh
else
  echo "--  shellcheck not installed: skipped"
fi
python3 -m unittest discover -s tests -v
