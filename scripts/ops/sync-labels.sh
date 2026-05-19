#!/usr/bin/env bash
# sync-labels.sh: Idempotent label seeder for pawtropolis-tech.
#
# Creates or updates every label defined in .github/labels.yml on the
# remote GitHub repo. Safe to re-run. Uses `gh label create --force`
# which creates-or-updates in one call.
#
# Source of truth: docs/issue-system.md and .github/labels.yml.
# Engine reference: scripts/ops/sync-tasks.py expects these labels to exist.

set -euo pipefail

# Require gh + authenticated session
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not installed" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated. Run: gh auth login" >&2; exit 1; }

# Verify repo
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [[ "$REPO" != "watchthelight/pawtropolis-tech" ]]; then
  echo "ERROR: wrong repo. Expected watchthelight/pawtropolis-tech, got $REPO" >&2
  exit 1
fi

# Format: name|color|description
LABELS=(
  # Type labels
  "TODO|1f6feb|Managed issue (mirrored from todo/NNNNN.md)"
  "bug|d73a4a|Defect in shipped behavior"
  "feat|a2eeef|New feature or capability"
  "chore|cfd3d7|Maintenance, deps, CI, infra"
  "audit|e99695|Came from an audit finding"
  "security|b60205|Security or abuse-surface issue"
  "question|d876e3|Decision needed before progress"
  "refactor|fbca04|Code shape change with no behavior change"
  # Priority labels
  "Critical|b60205|P0 - urgent"
  "High|d93f0b|P1"
  "Medium|fbca04|P2"
  "Low|0e8a16|P3"
  "Nominal|bfd4f2|Background work"
  # Status labels
  "IP|0e8a16|In progress (commit activity detected)"
  "Blocked (Internal)|5319e7|Blocked on a decision or upstream todo"
  "Blocked (External)|b60205|Blocked on a vendor or external party"
)

count=0

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<< "$entry"
  if gh label create "$name" --color "$color" --description "$desc" --force >/dev/null 2>&1; then
    echo "ok: $name"
    count=$((count + 1))
  else
    echo "ERROR: failed to create/update label: $name" >&2
    exit 1
  fi
done

echo ""
echo "Done. $count labels processed."
