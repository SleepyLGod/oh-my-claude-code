#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

export PATH="$SCRIPT_DIR:$PATH"

cd "$REPO_ROOT"
exec npx -y @zed-industries/claude-agent-acp@0.21.0 "$@"
