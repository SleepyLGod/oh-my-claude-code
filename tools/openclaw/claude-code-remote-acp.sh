#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

export CLAUDE_CODE_OPENCLAW_REMOTE_MIRROR=1

exec /bin/bash "$REPO_ROOT/tools/openclaw/claude-code-acp.sh" "$@"
