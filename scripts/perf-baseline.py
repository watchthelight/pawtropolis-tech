#!/usr/bin/env python3
"""
Reads pm2 JSON-line logs, aggregates wide events, prints baseline stats.
Usage: python3 perf-baseline.py /home/ubuntu/.pm2/logs/pawtropolis-out.log [/home/ubuntu/.pm2/logs/pawtropolis-error.log]
"""
import json
import sys
import math
from collections import defaultdict, Counter

def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = math.floor(k); c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] + (s[c] - s[f]) * (k - f)

def fmt(n):
    if n is None: return "-"
    if n >= 1000: return f"{n/1000:.1f}s"
    return f"{int(n)}ms"

def main():
    paths = sys.argv[1:]
    cmd_durations = defaultdict(list)
    event_durations = defaultdict(list)
    error_by_command = Counter()
    failure_reasons = Counter()
    slow_tx = 0
    sqlite_busy_by_route = Counter()
    db_errors = Counter()
    phase_long = []  # (phase_name, command, durationMs)
    total_lines = 0
    json_lines = 0
    wide_events = 0
    earliest = None
    latest = None

    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                total_lines += 1
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                json_lines += 1
                t = o.get("time")
                if t:
                    if earliest is None or t < earliest: earliest = t
                    if latest is None or t > latest: latest = t

                msg = o.get("msg", "")
                if "Slow transaction detected" in msg:
                    slow_tx += 1

                err = o.get("err") or {}
                code = err.get("code") if isinstance(err, dict) else None
                if code in ("SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"):
                    route = "?"
                    if isinstance(err, dict):
                        stack = err.get("stack", "")
                        for line2 in stack.split("\n"):
                            if "src/" in line2 or "src\\" in line2 or "/dist/" in line2:
                                route = line2.strip().split()[-1]
                                break
                    sqlite_busy_by_route[route] += 1
                if o.get("evt") == "db_error":
                    db_errors[o.get("sql", "?")[:80]] += 1

                if o.get("evt") == "wide_event":
                    wide_events += 1
                    cmd = o.get("command")
                    feat = o.get("feature")
                    dur = o.get("durationMs")
                    outcome = o.get("outcome")
                    if dur is None: continue
                    key = cmd or feat or "?"
                    if cmd:
                        cmd_durations[cmd].append(dur)
                    elif feat:
                        event_durations[feat].append(dur)
                    if outcome == "error":
                        error_by_command[key] += 1
                        reason = o.get("resp_failureReason") or "?"
                        failure_reasons[(key, reason)] += 1
                    phases_str = o.get("phases", "")
                    # phases is a comma-separated list of names; per-phase ms is not in this log shape
                    # so skip phase_long aggregation (would need richer log)

    # Output
    print(f"# Pawtropolis perf baseline — {total_lines} lines, {json_lines} JSON, {wide_events} wide events")
    if earliest and latest:
        from datetime import datetime, timezone
        e = datetime.fromtimestamp(earliest/1000, tz=timezone.utc).isoformat()
        l = datetime.fromtimestamp(latest/1000, tz=timezone.utc).isoformat()
        span_h = (latest - earliest) / 1000 / 3600
        print(f"\nWindow: {e} → {l} ({span_h:.1f}h)")
    print(f"\nSlow tx (>100ms): {slow_tx}")
    print(f"SQLITE_BUSY events: {sum(sqlite_busy_by_route.values())}")
    if sqlite_busy_by_route:
        print("  by route:")
        for r, n in sqlite_busy_by_route.most_common(10):
            print(f"    {n:4d} {r}")
    print(f"db_error distinct SQLs: {len(db_errors)}")
    if db_errors:
        for sql, n in db_errors.most_common(5):
            print(f"    {n:4d} {sql}")

    print("\n## Slowest commands (by p95)")
    print(f"{'cmd':40s} {'n':>6s} {'p50':>8s} {'p95':>8s} {'p99':>8s} {'max':>8s} {'errs':>5s}")
    rows = []
    for cmd, ds in cmd_durations.items():
        rows.append((cmd, len(ds), pct(ds,50), pct(ds,95), pct(ds,99), max(ds), error_by_command.get(cmd,0)))
    rows.sort(key=lambda r: -(r[3] or 0))
    for r in rows[:30]:
        print(f"{r[0][:40]:40s} {r[1]:6d} {fmt(r[2]):>8s} {fmt(r[3]):>8s} {fmt(r[4]):>8s} {fmt(r[5]):>8s} {r[6]:5d}")

    print("\n## Slowest events / features (by p95)")
    print(f"{'event':40s} {'n':>6s} {'p50':>8s} {'p95':>8s} {'p99':>8s} {'max':>8s} {'errs':>5s}")
    rows = []
    for ev, ds in event_durations.items():
        rows.append((ev, len(ds), pct(ds,50), pct(ds,95), pct(ds,99), max(ds), error_by_command.get(ev,0)))
    rows.sort(key=lambda r: -(r[3] or 0))
    for r in rows[:30]:
        print(f"{r[0][:40]:40s} {r[1]:6d} {fmt(r[2]):>8s} {fmt(r[3]):>8s} {fmt(r[4]):>8s} {fmt(r[5]):>8s} {r[6]:5d}")

    print("\n## Top error commands")
    for cmd, n in error_by_command.most_common(20):
        print(f"  {n:5d} {cmd}")

    print("\n## Top failure reasons")
    for (cmd, reason), n in failure_reasons.most_common(20):
        print(f"  {n:5d} [{cmd}] {reason}")

if __name__ == "__main__":
    main()
