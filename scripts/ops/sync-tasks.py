#!/usr/bin/env python3
"""Sync local task files to GitHub Issues.

One-way push: files are source of truth, Issues are a mirror for notifications
and mobile UX. Run via the /sync-tasks skill.

Solo-mode adaptation of blue-walmart's sync engine. Differences vs source:
  - No Phase B comment interpretation (no pending-decisions.json)
  - No assignee logic (no multi-developer routing)
  - No SAMQUESTIONS/TOBYQUESTIONS parsing (questions become regular todos with
    type=question; optional OPEN-QUESTIONS.md not yet parsed)
  - Type drives the type-label, replacing Owner -> CTO/CEO mapping
  - Repo check: watchthelight/pawtropolis-tech

Files scanned:
  - todo/*.md  -> open todo issues
  - done/*.md  -> closed todo issues

Issues are matched to files by title prefix: [NNNNN]. That prefix is the
permanent identity anchor.

Usage:
  python scripts/ops/sync-tasks.py [--dry-run] [--no-pull] [--verbose]
  python scripts/ops/sync-tasks.py next-id
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TODO_DIR = REPO_ROOT / "todo"
DONE_DIR = REPO_ROOT / "done"
SIDECAR_DIR = REPO_ROOT / ".claude" / "state" / "sync-tasks-sidecar"
CURSOR_FILE = SIDECAR_DIR / "cursor.json"

EXPECTED_REPO = "watchthelight/pawtropolis-tech"

EM_DASH = "—"
EN_DASH = "–"
CURLY_DOUBLE_OPEN = "“"
CURLY_DOUBLE_CLOSE = "”"
CURLY_SINGLE_OPEN = "‘"
CURLY_SINGLE_CLOSE = "’"

# Type -> GH label. Both name and label string are the same; this map exists
# to validate the file's Type field.
TYPE_LABELS = {
    "bug": "bug",
    "feat": "feat",
    "chore": "chore",
    "audit": "audit",
    "security": "security",
    "question": "question",
    "refactor": "refactor",
}

PRIORITY_MAP = {
    "P0": "Critical",
    "P1": "High",
    "P2": "Medium",
    "P3": "Low",
    "Critical": "Critical",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
    "Nominal": "Nominal",
}

# Flat managed labels. We only touch these on reconcile; ad-hoc labels added
# by hand are preserved.
MANAGED_LABELS = {
    "TODO",
    "bug", "feat", "chore", "audit", "security", "question", "refactor",
    "Critical", "High", "Medium", "Low", "Nominal",
    "IP", "Blocked (Internal)", "Blocked (External)",
}

AI_SLOP_PHRASES = [
    r"\bit'?s worth noting\b",
    r"\bworth noting\b",
    r"\bit'?s important to note\b",
    r"\bmoreover\b",
    r"\bfurthermore\b",
    r"\bdelve\b",
    r"\bnuanced take\b",
]


@dataclass
class Item:
    id: str
    title_prefix: str
    title: str
    body: str
    labels: list[str] = field(default_factory=list)
    is_closed: bool = False
    close_reason: str | None = None
    source_file: str = ""


def run_gh(args: list[str], body: str | None = None) -> tuple[int, str, str]:
    result = subprocess.run(
        ["gh", *args],
        input=body,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=REPO_ROOT,
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def gh_must(args: list[str], body: str | None = None) -> str:
    code, out, err = run_gh(args, body)
    if code != 0:
        print(f"FAIL gh {' '.join(args)}: {err}", file=sys.stderr)
        sys.exit(1)
    return out


def run_git(args: list[str]) -> tuple[int, str, str]:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=REPO_ROOT,
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def mechanical_humanize(text: str) -> str:
    text = text.replace(EM_DASH, "--").replace(EN_DASH, "-")
    text = text.replace(CURLY_DOUBLE_OPEN, '"').replace(CURLY_DOUBLE_CLOSE, '"')
    text = text.replace(CURLY_SINGLE_OPEN, "'").replace(CURLY_SINGLE_CLOSE, "'")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def scan_for_slop(text: str) -> list[str]:
    hits = []
    for patt in AI_SLOP_PHRASES:
        if re.search(patt, text, re.IGNORECASE):
            hits.append(patt)
    return hits


# ---------- Parsers ----------

TODO_TITLE_RE = re.compile(r"^#\s+#(\d{5})(?:\s+(?:--|—))?\s+(.+)$")
# Type drives the type label. Priority and Status mirror blue-walmart.
META_RE = re.compile(
    r"\*\*Type:\*\*\s+([a-z]+?)"
    r"(?:\s*\|\s*\*\*Priority:\*\*\s+(P[0-3]|Critical|High|Medium|Low|Nominal))?"
    r"(?:\s*\|\s*\*\*Status:\*\*\s+`?([^`\n]+?)`?\s*)?$",
    re.MULTILINE,
)


def parse_todo_file(path: Path, is_done: bool) -> tuple[dict, list[str]]:
    """Returns (parsed_dict, errors)."""
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    rel = path.relative_to(REPO_ROOT).as_posix()

    num = path.stem
    if not lines:
        errors.append(f"{rel}: empty file")
        return {}, errors
    h1_match = TODO_TITLE_RE.match(lines[0])
    if not h1_match:
        errors.append(
            f"{rel}:1: title does not match `# #NNNNN -- <Title>`; got: {lines[0]!r}"
        )
        title = num
    else:
        title = h1_match.group(2).strip()

    meta_m = META_RE.search(text)
    type_field = priority = status = None
    if meta_m:
        type_field = meta_m.group(1).strip().lower()
        priority = meta_m.group(2) or None
        status = meta_m.group(3) or None
    elif not is_done:
        errors.append(f"{rel}: missing Type/Priority/Status line")

    if type_field and type_field not in TYPE_LABELS:
        errors.append(
            f"{rel}: invalid Type `{type_field}`. "
            f"Valid: {sorted(TYPE_LABELS.keys())}"
        )

    for i, ln in enumerate(lines, 1):
        if EM_DASH in ln and i != 1:  # allow legacy in H1
            errors.append(f"{rel}:{i}: em dash (\\u2014) not allowed; use `--`")
        if EN_DASH in ln:
            errors.append(f"{rel}:{i}: en dash (\\u2013) not allowed; use `-`")

    body = "\n".join(lines[1:]).strip()

    status_tag = (status or "").strip()
    is_complete = status_tag.upper().startswith("COMPLETE")

    return {
        "num": num,
        "title": title,
        "type": type_field,
        "priority": priority,
        "status": status_tag,
        "body": body,
        "is_done": is_done or is_complete,
        "source_file": rel,
    }, errors


# ---------- Renderers ----------


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_title(t: str) -> str:
    t = re.sub(rf"\s*[{EM_DASH}{EN_DASH}]\s*", " ", t)
    t = re.sub(r"\s*--\s*", " ", t)
    t = re.sub(r"\s+:\s*", ": ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def render_todo(parsed: dict) -> Item:
    num = parsed["num"]
    title_prefix = f"[{num}]"
    title = f"{title_prefix} {clean_title(parsed['title'])}"

    labels = ["TODO"]
    type_field = parsed.get("type") or ""
    if type_field in TYPE_LABELS:
        labels.append(TYPE_LABELS[type_field])
    pri_map_val = PRIORITY_MAP.get(parsed.get("priority") or "")
    if pri_map_val:
        labels.append(pri_map_val)

    status = (parsed.get("status") or "").upper()
    if status.startswith("WIP"):
        labels.append("IP")
    elif status.startswith("BLOCKED:") or status.startswith("PAUSED"):
        # Default to Internal unless the reason mentions external party
        reason = status.split(":", 1)[1].lower() if ":" in status else ""
        if any(k in reason for k in ("vendor", "external", "discord", "github", "aws", "cloudflare", "stripe")):
            labels.append("Blocked (External)")
        else:
            labels.append("Blocked (Internal)")

    body_clean = mechanical_humanize(parsed["body"])
    body = (
        f"## Context\n{body_clean}\n\n"
        f"## Meta\n"
        f"- Source: `{parsed['source_file']}`\n"
        f"- Type: {parsed.get('type') or 'unset'}\n"
        f"- Priority: {parsed.get('priority') or 'unset'}\n"
        f"- Status: {parsed.get('status') or 'none'}\n"
        f"- Last synced: {now_utc_iso()}\n\n"
        f"---\nManaged by `/sync-tasks`. The file is source of truth; "
        f"edits there propagate to this issue on the next sync."
    )

    return Item(
        id=num,
        title_prefix=title_prefix,
        title=title,
        body=body,
        labels=labels,
        is_closed=parsed["is_done"],
        close_reason=(
            f"Completed; moved to `{parsed['source_file']}`."
            if parsed["is_done"]
            else None
        ),
        source_file=parsed["source_file"],
    )


# ---------- GitHub ----------


def fetch_issues() -> dict[str, dict]:
    """Return map of title_prefix -> issue info."""
    out = gh_must([
        "issue", "list",
        "--state", "all",
        "--limit", "500",
        "--json", "number,title,state,body,labels",
    ])
    issues = json.loads(out) if out else []
    by_prefix: dict[str, dict] = {}
    for iss in issues:
        m = re.match(r"^(\[\d{5}\])\s", iss["title"])
        if m:
            by_prefix[m.group(1)] = iss
    return by_prefix


def label_set(issue: dict) -> set[str]:
    return {lbl["name"] for lbl in issue.get("labels", [])}


# ---------- Pre-flight ----------


def preflight(no_pull: bool) -> None:
    code, _, err = run_gh(["auth", "status"])
    if code != 0:
        print("FAIL gh auth status:\n" + err, file=sys.stderr)
        sys.exit(1)

    code, out, _ = run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    if code != 0 or out.strip() != EXPECTED_REPO:
        print(
            f"FAIL repo mismatch: got {out!r}, want {EXPECTED_REPO!r}",
            file=sys.stderr,
        )
        sys.exit(1)

    if not no_pull:
        code, _, err = run_git(["fetch", "origin"])
        if code != 0:
            print(f"FAIL git fetch: {err}", file=sys.stderr)
            sys.exit(1)
        # Determine current branch
        code, branch, _ = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        if code == 0 and branch != "HEAD":
            code, _, err = run_git(["pull", "--ff-only", "origin", branch])
            if code != 0:
                # Non-fatal: branch may not have an upstream yet (new branch).
                # Warn but proceed.
                if "no tracking information" not in err.lower() and "couldn't find remote ref" not in err.lower():
                    print(f"WARN git pull --ff-only: {err}", file=sys.stderr)


# ---------- Reconcile ----------


def is_managed(label: str) -> bool:
    return label in MANAGED_LABELS


def labels_equal(a: set[str], b: set[str]) -> bool:
    return {l for l in a if is_managed(l)} == {l for l in b if is_managed(l)}


def reconcile(items: list[Item], issues: dict[str, dict], dry_run: bool, verbose: bool) -> dict:
    stats = {
        "created": 0,
        "updated": 0,
        "closed": 0,
        "reopened": 0,
        "skipped": 0,
        "orphans": 0,
    }
    created_urls: list[str] = []

    for item in items:
        existing = issues.get(item.title_prefix)
        if existing is None:
            if dry_run:
                print(f"  CREATE  {item.title}")
            else:
                args = [
                    "issue", "create",
                    "--title", item.title,
                    "--body-file", "-",
                ]
                for lbl in item.labels:
                    args += ["--label", lbl]
                url = gh_must(args, body=item.body)
                created_urls.append(url)
                if verbose:
                    print(f"  CREATE  {item.title_prefix}: {url}")
                num = url.rsplit("/", 1)[-1]
                if item.is_closed and item.close_reason:
                    gh_must(["issue", "close", num, "--comment", item.close_reason])
                    stats["closed"] += 1
                time.sleep(0.3)
            stats["created"] += 1
            continue

        num = str(existing["number"])

        def _normalize(b: str) -> str:
            b = (b or "").replace("\r\n", "\n")
            return re.sub(r"^- Last synced:.*$", "- Last synced: <normalized>", b, flags=re.MULTILINE).strip()

        body_changed = _normalize(existing.get("body") or "") != _normalize(item.body)
        labels_changed = not labels_equal(label_set(existing), set(item.labels))
        state = existing["state"].upper()

        did_update = False

        if body_changed:
            if dry_run:
                if verbose:
                    print(f"  UPDATE  #{num} body changed")
            else:
                gh_must(["issue", "edit", num, "--body-file", "-"], body=item.body)
                if verbose:
                    print(f"  UPDATE  #{num} body")
                time.sleep(0.3)
            did_update = True

        if labels_changed:
            if dry_run:
                if verbose:
                    print(f"  UPDATE  #{num} labels {label_set(existing)} -> {set(item.labels)}")
            else:
                current = label_set(existing)
                managed_current = {l for l in current if is_managed(l)}
                to_remove = managed_current - set(item.labels)
                to_add = set(item.labels) - current
                args = ["issue", "edit", num]
                for lbl in to_add:
                    args += ["--add-label", lbl]
                for lbl in to_remove:
                    args += ["--remove-label", lbl]
                if to_add or to_remove:
                    gh_must(args)
                    if verbose:
                        print(f"  UPDATE  #{num} labels")
                    time.sleep(0.3)
            did_update = True

        if item.is_closed and state == "OPEN":
            if dry_run:
                print(f"  CLOSE   #{num} {item.title_prefix}")
            else:
                reason = item.close_reason or "Marked done via sync."
                gh_must(["issue", "close", num, "--comment", reason])
                if verbose:
                    print(f"  CLOSE   #{num}")
                time.sleep(0.3)
            stats["closed"] += 1
        elif not item.is_closed and state == "CLOSED":
            if dry_run:
                print(f"  REOPEN  #{num} {item.title_prefix}")
            else:
                gh_must(["issue", "reopen", num])
                if verbose:
                    print(f"  REOPEN  #{num}")
                time.sleep(0.3)
            stats["reopened"] += 1
        elif did_update:
            stats["updated"] += 1
        else:
            stats["skipped"] += 1

    item_prefixes = {it.title_prefix for it in items}
    for prefix, iss in issues.items():
        if prefix not in item_prefixes:
            stats["orphans"] += 1
            print(f"  ORPHAN  #{iss['number']} {iss['title']}  (no matching file)")

    if created_urls:
        print("\nCreated issues:")
        for u in created_urls:
            print(f"  {u}")

    return stats


# ---------- Sidecar ----------


def write_cursor(head_sha: str) -> None:
    SIDECAR_DIR.mkdir(parents=True, exist_ok=True)
    code, email, _ = run_git(["config", "user.email"])
    data = {
        "lastSyncedAt": now_utc_iso(),
        "lastSyncedBy": email if code == 0 else "unknown",
        "lastHeadSha": head_sha,
        "schemaVersion": 1,
    }
    CURSOR_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


# ---------- Main ----------


def cmd_next_id() -> int:
    """Print the next available 5-digit todo id."""
    max_id = 0
    for d in (TODO_DIR, DONE_DIR):
        if not d.exists():
            continue
        for p in d.glob("*.md"):
            stem = p.stem
            if stem.isdigit():
                max_id = max(max_id, int(stem))
    print(f"{max_id + 1:05d}")
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "next-id":
        sys.exit(cmd_next_id())

    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-pull", action="store_true")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    preflight(args.no_pull)

    errors: list[str] = []
    warnings: list[str] = []
    items: list[Item] = []
    todo_ids: dict[str, str] = {}
    done_ids: dict[str, str] = {}

    if TODO_DIR.exists():
        for path in sorted(TODO_DIR.glob("*.md")):
            parsed, errs = parse_todo_file(path, is_done=False)
            errors.extend(errs)
            if parsed:
                todo_ids[parsed["num"]] = parsed["source_file"]
                slop = scan_for_slop(parsed["body"])
                if slop:
                    warnings.append(
                        f"{parsed['source_file']}: AI slop patterns: {slop}."
                    )
                items.append(render_todo(parsed))

    if DONE_DIR.exists():
        for path in sorted(DONE_DIR.glob("*.md")):
            parsed, errs = parse_todo_file(path, is_done=True)
            errors.extend(errs)
            if parsed:
                done_ids[parsed["num"]] = parsed["source_file"]
                items.append(render_todo(parsed))

    collisions = set(todo_ids) & set(done_ids)
    for cid in sorted(collisions):
        errors.append(
            f"ID collision: {todo_ids[cid]} and {done_ids[cid]} both claim id {cid}. "
            f"Rename one to the next free id."
        )

    if errors:
        print("VALIDATION ERRORS:", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        print("\nFix errors then retry.", file=sys.stderr)
        sys.exit(2)

    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"  {w}")
        print()

    print(f"Parsed {len(items)} items from local files.")

    issues = fetch_issues()
    print(f"Fetched {len(issues)} issues from GitHub (prefix-matched).")

    print(f"\nReconciling{' (dry-run)' if args.dry_run else ''}...")
    stats = reconcile(items, issues, args.dry_run, args.verbose)

    print("\nSummary:")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    if not args.dry_run:
        code, sha, _ = run_git(["rev-parse", "--short", "HEAD"])
        write_cursor(sha if code == 0 else "unknown")
        print(f"\nCursor updated: {CURSOR_FILE.relative_to(REPO_ROOT).as_posix()}")


if __name__ == "__main__":
    main()
