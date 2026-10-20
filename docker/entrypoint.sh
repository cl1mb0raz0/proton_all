#!/bin/sh
# Starts Whatever Was Asked (pdrive-web By Default). The Proton Login Is Done In
# The Browser, So Nothing Needs To Be Configured Here.
set -eu

export PDRIVE_REMOTE="${PDRIVE_REMOTE:-proton}"
exec "$@"
