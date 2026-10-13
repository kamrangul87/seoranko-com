#!/usr/bin/env bash
# Fail when fixtures/seoranko-fixture-site/expected.json changes without a
# seoranko-fixture seed commit link in the PR body (or commit message on main).
set -euo pipefail

EXPECTED_PATH='fixtures/seoranko-fixture-site/expected.json'
REPO_SLUG='kamrangul87/seoranko-fixture'

changed=false
if [[ "${GITHUB_EVENT_NAME:-}" == 'pull_request' ]]; then
  base="${GITHUB_BASE_REF:-main}"
  git fetch origin "$base" --depth=1 >/dev/null 2>&1 || true
  if git diff --name-only "origin/${base}...HEAD" | grep -qx "$EXPECTED_PATH"; then
    changed=true
  fi
elif [[ "${GITHUB_EVENT_NAME:-}" == 'push' ]]; then
  before="${GITHUB_EVENT_BEFORE:-}"
  after="${GITHUB_SHA:-HEAD}"
  if [[ -n "$before" && "$before" != '0000000000000000000000000000000000000000' ]]; then
    if git diff --name-only "$before" "$after" | grep -qx "$EXPECTED_PATH"; then
      changed=true
    fi
  elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    if git diff --name-only HEAD~1 HEAD | grep -qx "$EXPECTED_PATH"; then
      changed=true
    fi
  fi
else
  # Local / unknown: compare against merge-base with origin/main when available.
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    if git diff --name-only origin/main...HEAD | grep -qx "$EXPECTED_PATH"; then
      changed=true
    fi
  fi
fi

if [[ "$changed" != 'true' ]]; then
  echo "check-expected-json-seed-link: $EXPECTED_PATH unchanged — ok"
  exit 0
fi

body=''
if [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]]; then
  body=$(python3 - <<'PY'
import json, os
with open(os.environ['GITHUB_EVENT_PATH']) as f:
    ev = json.load(f)
pr = ev.get('pull_request') or {}
parts = [pr.get('body') or '', pr.get('title') or '']
# push events: use commit messages in the push
commits = ev.get('commits') or []
for c in commits:
    parts.append(c.get('message') or '')
print('\n'.join(parts))
PY
)
fi
if [[ -z "$body" ]]; then
  body=$(git log -1 --pretty=%B 2>/dev/null || true)
fi

# Accept full commit URLs or compare/tree links that include a 7–40 hex SHA.
# Also accept seedCommitSha documented as matching in expected.json only when
# the PR body explicitly links the fixture repo commit.
pattern="https?://github.com/${REPO_SLUG}/(commit|commits)/[0-9a-fA-F]{7,40}"

if echo "$body" | grep -Eiq "$pattern"; then
  echo "check-expected-json-seed-link: found seoranko-fixture seed commit link — ok"
  exit 0
fi

echo "::error::${EXPECTED_PATH} changed but the PR description (or push commit message) does not link a matching kamrangul87/seoranko-fixture seed commit."
echo "Add a link like: https://github.com/${REPO_SLUG}/commit/<seed-sha>"
echo "See docs/ENGINEERING_RULES.md — expected.json seed commit link rule."
exit 1
