#!/usr/bin/env bash
# Cloud Agent install — idempotent dependency bootstrap.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

# Ensure helper scripts are executable when present.
chmod +x scripts/cloud-agent-start.sh 2>/dev/null || true
