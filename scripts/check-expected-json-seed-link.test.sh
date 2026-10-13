#!/usr/bin/env bash
# Local smoke for the seed-link pattern (not the full git-diff gate).
set -euo pipefail
pattern='https?://github.com/kamrangul87/seoranko-fixture/(commit|commits)/[0-9a-fA-F]{7,40}'
ok='See seed https://github.com/kamrangul87/seoranko-fixture/commit/6ed5aff for topic 72'
bad='Updated expected.json for topic 72'
echo "$ok" | grep -Eiq "$pattern"
! echo "$bad" | grep -Eiq "$pattern"
echo 'pattern smoke ok'
