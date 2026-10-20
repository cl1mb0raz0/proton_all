#!/usr/bin/env bash
# install.sh - Installs Proton All (And Rclone) On The Current Machine.
#
# If An rclone.conf Sits Next To This File It Is Installed Too, So That Proton
# Drive Authentication Stays Valid And No Fresh Login Is Needed.
#
# Usage:  ./install.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
CONF_DIR="$HOME/.config/rclone"
CONF="$CONF_DIR/rclone.conf"

if [[ -t 1 ]]; then B=$'\e[1m'; R=$'\e[0m'; GR=$'\e[32m'; YL=$'\e[33m'; RD=$'\e[31m'
else B=''; R=''; GR=''; YL=''; RD=''; fi
info() { printf '%s\n' "${B}==>${R} $*"; }
ok()   { printf '%s\n' "${GR}✓${R} $*"; }
warn() { printf '%s\n' "${YL}!${R} $*" >&2; }
die()  { printf '%s\n' "${RD}✗${R} $*" >&2; exit 1; }

command -v curl  >/dev/null || die "curl is required."
command -v unzip >/dev/null || die "unzip is required."

mkdir -p "$BIN_DIR"

# -------------------------------------------------------------------- 1. Rclone
have_protondrive() {
  local bin=$1
  [[ -x "$bin" ]] && "$bin" help backends 2>/dev/null | grep -qi protondrive
}

RCLONE=""
for c in "$BIN_DIR/rclone" "$(command -v rclone 2>/dev/null || true)"; do
  [[ -n "$c" ]] && have_protondrive "$c" && { RCLONE="$c"; break; }
done

if [[ -n "$RCLONE" ]]; then
  ok "rclone with the Proton Drive backend is already present: $("$RCLONE" version | head -1)"
else
  case "$(uname -m)" in
    x86_64)  arch=amd64 ;;
    aarch64) arch=arm64 ;;
    armv7l)  arch=arm-v7 ;;
    *) die "Unsupported architecture: $(uname -m)" ;;
  esac

  command -v sha256sum >/dev/null || die "sha256sum is required."
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  base=https://downloads.rclone.org
  ver=$(curl -fsS "$base/version.txt" | awk '{print $2}')
  [[ "$ver" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not read the current rclone version."
  zip="rclone-$ver-linux-$arch.zip"

  info "Downloading rclone $ver (linux-$arch)..."
  curl -fL --progress-bar -o "$tmp/$zip" "$base/$ver/$zip"
  # The checksum catches a damaged or truncated download. It comes from the same
  # server, so it does not replace checking the PGP signature of SHA256SUMS.
  want=$(curl -fsS "$base/$ver/SHA256SUMS" | awk -v f="$zip" '$2 == f {print $1}')
  [[ -n "$want" ]] || die "No checksum published for $zip."
  have=$(sha256sum "$tmp/$zip" | awk '{print $1}')
  [[ "$have" == "$want" ]] || die "Checksum mismatch for $zip (got $have, expected $want)."
  ok "Checksum verified."
  unzip -q -o "$tmp/$zip" -d "$tmp"
  bin=$(find "$tmp" -type f -name rclone -perm -u+x | head -1)
  [[ -n "$bin" ]] || die "No rclone binary inside the archive."
  install -m 755 "$bin" "$BIN_DIR/rclone"
  RCLONE="$BIN_DIR/rclone"
  have_protondrive "$RCLONE" || die "The downloaded rclone has no protondrive backend."
  ok "Installed: $("$RCLONE" version | head -1)"
fi

# -------------------------------------------------------------------- 2. Pdrive
[[ -f "$HERE/pdrive" ]] || die "pdrive not found next to install.sh"
install -m 755 "$HERE/pdrive" "$BIN_DIR/pdrive"
ok "pdrive installed at $BIN_DIR/pdrive"
[[ -f "$HERE/pdrive-selftest" ]] && install -m 755 "$HERE/pdrive-selftest" "$BIN_DIR/pdrive-selftest"

# Optional Local Web Ui (Needs python3, Nothing Else).
if [[ -f "$HERE/pdrive-web" && -d "$HERE/webui" ]]; then
  if command -v python3 >/dev/null; then
    WEB_DIR="$HOME/.local/share/pdrive-web/webui"
    mkdir -p "$WEB_DIR"
    install -m 644 "$HERE"/webui/* "$WEB_DIR/"
    install -m 755 "$HERE/pdrive-web" "$BIN_DIR/pdrive-web"
    ok "pdrive-web installed at $BIN_DIR/pdrive-web"
  else
    warn "python3 not found: skipping pdrive-web (the terminal pdrive still works)."
  fi
fi

# --------------------------------------------------------- 3. configuration/login
if [[ -f "$HERE/rclone.conf" ]]; then
  mkdir -p "$CONF_DIR"
  if [[ -f "$CONF" ]]; then
    if grep -q '^\[proton\]' "$CONF" 2>/dev/null; then
      warn "A [proton] remote already exists in $CONF"
      read -rp "Overwrite it? A backup is taken first. [y/N] " a
      if [[ "${a,,}" != y* ]]; then
        warn "Configuration left untouched."
        SKIP_CONF=1
      fi
    fi
    if [[ -z "${SKIP_CONF:-}" ]]; then
      backup="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
      cp -p "$CONF" "$backup"
      ok "Backup of the existing configuration: $backup"
    fi
  fi
  if [[ -z "${SKIP_CONF:-}" ]]; then
    install -m 600 "$HERE/rclone.conf" "$CONF"
    ok "Configuration installed ($CONF, mode 600)"
  fi
else
  warn "No rclone.conf in this package: pdrive will open 'rclone config' on first run."
fi

# --------------------------------------------------------------------- 4. Checks
if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
  warn "$BIN_DIR is not in your PATH. Add this to your ~/.bashrc:"
  printf '\n    export PATH="$HOME/.local/bin:$PATH"\n\n'
fi

if [[ -f "$CONF" ]] && grep -q '^\[proton\]' "$CONF"; then
  info "Trying to read the root of Proton Drive..."
  if "$RCLONE" lsd proton: --protondrive-replace-existing-draft=true >/dev/null 2>&1; then
    ok "Authentication is valid: the remote responds."
  else
    warn "The remote did not respond. Likely causes:"
    echo "    - session invalidated (used on two machines at the same time)"
    echo "    - app-specific password revoked"
    echo "    Log in again with:  $RCLONE config reconnect proton:"
    echo "    or recreate the remote with:  $RCLONE config"
  fi
fi

echo
ok "Ready. Start it with:  ${B}pdrive${R}"
