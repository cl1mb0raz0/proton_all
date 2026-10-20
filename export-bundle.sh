#!/usr/bin/env bash
# export-bundle.sh - Builds A Package To Carry Over To Another Machine.
#
# Includes Proton All, install.sh, README.md And, By Default, The Rclone
# Configuration Holding The Proton Drive Credentials, So That No Fresh Login Is
# Needed On The Other Machine.
#
# Usage:
#   ./export-bundle.sh              # includes rclone.conf (credentials inside)
#   ./export-bundle.sh --no-config  # scripts only, log in again at destination

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
INCLUDE_CONF=1
[[ "${1:-}" == "--no-config" ]] && INCLUDE_CONF=0

if [[ -t 1 ]]; then B=$'\e[1m'; R=$'\e[0m'; GR=$'\e[32m'; YL=$'\e[33m'; RD=$'\e[31m'
else B=''; R=''; GR=''; YL=''; RD=''; fi
ok()   { printf '%s\n' "${GR}✓${R} $*"; }
warn() { printf '%s\n' "${YL}!${R} $*" >&2; }
die()  { printf '%s\n' "${RD}✗${R} $*" >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
out="$HERE/proton-bundle-$stamp.tar.gz"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
pkg="$staging/Proton"
mkdir -p "$pkg"

for f in pdrive pdrive-web pdrive-selftest install.sh README.md; do
  [[ -f "$HERE/$f" ]] || die "Missing $f in $HERE"
  cp -p "$HERE/$f" "$pkg/$f"
done
[[ -d "$HERE/webui" ]] || die "Missing webui/ in $HERE"
cp -rp "$HERE/webui" "$pkg/webui"
chmod 755 "$pkg/pdrive" "$pkg/pdrive-web" "$pkg/install.sh"

if (( INCLUDE_CONF )); then
  [[ -f "$CONF" ]] || die "rclone configuration not found: $CONF"
  grep -q '^\[' "$CONF" || die "$CONF contains no remote."
  install -m 600 "$CONF" "$pkg/rclone.conf"
  ok "Configuration included: $CONF"
  warn "This package contains your Proton Drive CREDENTIALS."
  echo "    rclone obscures the password but does NOT encrypt it: anyone who"
  echo "    reads the file gets full access to your Drive. Transfer it over a"
  echo "    secure channel only (scp / your own USB stick) and delete it after"
  echo "    installing."
else
  ok "Package built without credentials (log in again at the destination)."
fi

tar -C "$staging" -czf "$out" Proton
chmod 600 "$out"

echo
ok "Created: ${B}$out${R}"
printf '  sha256: %s\n' "$(sha256sum "$out" | cut -d' ' -f1)"
cat <<EOF

${B}On the other machine:${R}
    scp "$out" user@other-pc:~/
    ssh user@other-pc
    tar -xzf $(basename "$out") && cd Proton && ./install.sh
    shred -u ~/$(basename "$out")      # wipe the package once installed

${B}Important:${R} use pdrive on one machine at a time. Proton rotates session
tokens, so two machines using the same token concurrently will log each other
out. rclone logs back in by itself as long as the file holds username, password
and otp_secret_key; otherwise run 'rclone config reconnect proton:'.
EOF
