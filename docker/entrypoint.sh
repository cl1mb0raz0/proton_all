#!/bin/sh
set -eu

export PDRIVE_REMOTE="${PDRIVE_REMOTE:-proton}"
exec "$@"
