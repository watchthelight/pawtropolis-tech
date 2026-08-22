#!/usr/bin/env python3
"""Build the Pawtropolis Excel report.

Reads a Pawtropolis SQLite database and writes one workbook containing curated
analytics sheets, a raw dump of every remaining table, and reference sheets.

    python scripts/report/build_workbook.py --db path/to/data.db

The database is opened read-only, so this is safe to point at a live file.
"""

import argparse
import os
import sqlite3
import sys
import time
import zipfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xlsxwriter

import introspect
import raw as raw_tier
import toc
import writer
from panels import COVERED_BY_PANELS, PANELS

VERSION = "1.0.0"
DEFAULT_GUILD = "896070888594759740"

# Same default as scripts/charts/pull.js, so both analytics tools point at the
# same place when run from the repo root.
DEFAULT_DB = "data/data.db"


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Build the Pawtropolis Excel report.")
    parser.add_argument("--db", default=os.environ.get("DB_PATH", DEFAULT_DB),
                        help="path to data.db (opened read-only)")
    parser.add_argument("--out", default="out/pawtropolis-report.xlsx",
                        help="output .xlsx path")
    parser.add_argument("--guild-id", default=DEFAULT_GUILD)
    parser.add_argument("--max-rows", type=int, default=200_000,
                        help="row cap per raw sheet")
    parser.add_argument("--recent-messages", type=int, default=50_000,
                        help="rows on the recent messages sheet")
    parser.add_argument("--top-authors", type=int, default=5_000,
                        help="rows on the author ranking sheet")
    parser.add_argument("--only", default="",
                        help="comma separated panel names to build")
    parser.add_argument("--no-raw", action="store_true",
                        help="skip the raw table dump tier")
    parser.add_argument("--constant-memory", action="store_true",
                        help="stream rows with O(1) memory; disables some styling")
    return parser.parse_args(argv)


def connect_readonly(path):
    uri = "file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.text_factory = lambda b: b.decode("utf8", "replace")
    return conn


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    started = time.time()

    if not os.path.exists(args.db):
        print("error: database not found at " + args.db, file=sys.stderr)
        return 2

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    conn = connect_readonly(args.db)
    print("source : " + os.path.abspath(args.db))
    print("output : " + os.path.abspath(args.out))

    print("scanning schema...")
    tables, skipped = introspect.discover(conn)
    print("  %d tables with data, %d skipped" % (len(tables), len(skipped)))

    wb = xlsxwriter.Workbook(args.out, {
        "constant_memory": bool(args.constant_memory),
        "default_date_format": "yyyy-mm-dd hh:mm",
        "strings_to_urls": False,
    })
    report = writer.Report(wb, conn, args)

    contents_ws = wb.add_worksheet(report.sheet_name("Contents"))
    contents_ws.set_tab_color(writer.theme.CATEGORY_COLOR["nav"])

    last_msg = conn.execute(
        "SELECT MAX(created_at_s) FROM messages_archive WHERE guild_id = ?",
        (args.guild_id,),
    ).fetchone()[0] or int(time.time())

    ctx = {"guild_id": args.guild_id, "now": last_msg, "args": args, "kpis": {}}

    wanted = {n.strip() for n in args.only.split(",") if n.strip()}
    for name, build in PANELS:
        if wanted and name not in wanted:
            continue
        panel_started = time.time()
        try:
            build(report, ctx)
            print("  panel %-14s %.1fs" % (name, time.time() - panel_started))
        except Exception as exc:
            report.warn("panel %s failed: %s" % (name, exc))
            print("  panel %-14s FAILED: %s" % (name, exc), file=sys.stderr)

    if not args.no_raw:
        print("writing raw table dumps...")
        raw_started = time.time()
        count = raw_tier.build(report, ctx, tables, COVERED_BY_PANELS)
        print("  %d raw sheets in %.1fs" % (count, time.time() - raw_started))

    toc.write_schema_map(report, tables)
    toc.write_skipped(report, skipped)

    db_bytes = os.path.getsize(args.db)
    stats = [
        ("generator version", VERSION),
        ("generated at (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
        ("source database", os.path.abspath(args.db)),
        ("source size (bytes)", "{:,}".format(db_bytes)),
        ("guild id", args.guild_id),
        ("newest message in data", datetime.fromtimestamp(last_msg, tz=timezone.utc)
            .strftime("%Y-%m-%d %H:%M:%S")),
        ("tables with data", len(tables)),
        ("tables skipped", len(skipped)),
        ("sheets written", len(report.entries) + 1),
        ("raw row cap", "{:,}".format(args.max_rows)),
        ("recent messages cap", "{:,}".format(args.recent_messages)),
        ("top authors cap", "{:,}".format(args.top_authors)),
        ("total rows written", "{:,}".format(sum(e["written"] for e in report.entries))),
    ]
    toc.write_run_metadata(report, ctx, stats)
    toc.write_contents(report, contents_ws, ctx)

    wb.close()
    conn.close()

    size = os.path.getsize(args.out)
    print("")
    print("wrote %s (%s bytes) in %.1fs" % (args.out, "{:,}".format(size), time.time() - started))
    print("sheets: %d   rows: %s" % (
        len(report.entries) + 1,
        "{:,}".format(sum(e["written"] for e in report.entries)),
    ))

    bad = zipfile.ZipFile(args.out).testzip()
    if bad:
        print("error: workbook failed its zip integrity check at " + str(bad), file=sys.stderr)
        return 1
    print("zip integrity: ok")

    failures = toc.reconciliation_failures(report)
    for entry in failures:
        print("error: %s wrote %d rows but source has %d"
              % (entry["sheet"], entry["written"], entry["expected"]), file=sys.stderr)
    for message in report.warnings:
        print("warning: " + message, file=sys.stderr)

    if failures or report.warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
