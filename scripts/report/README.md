# Excel report generator

Builds one Excel workbook from a Pawtropolis SQLite database: curated analytics
sheets with charts and heatmaps, a raw dump of every remaining table, and
reference sheets describing what was produced.

## Setup

```
pip install -r scripts/report/requirements.txt
```

`sqlite3` comes from the standard library, so XlsxWriter is the only dependency.

## Run

```
npm run report:excel                      # uses data/data.db
python scripts/report/build_workbook.py --db path/to/data.db --out out/report.xlsx
```

The database is opened read-only through a `file:...?mode=ro` URI, so pointing
this at a live production file cannot modify it.

### Options

| Flag | Default | Purpose |
| --- | --- | --- |
| `--db` | `data/data.db` | Source database, or set `DB_PATH` |
| `--out` | `out/pawtropolis-report.xlsx` | Output path |
| `--guild-id` | main guild | Guild the analytics panels filter on |
| `--max-rows` | 200000 | Row cap per raw sheet |
| `--recent-messages` | 50000 | Rows on the recent messages sheet |
| `--top-authors` | 5000 | Rows on the author ranking sheet |
| `--only` | all | Comma separated panel names |
| `--no-raw` | off | Skip the raw dump tier |
| `--constant-memory` | off | Stream rows with O(1) memory |

## What comes out

Around 110 sheets in three tiers.

**Analytics** (charts, heatmaps, colour scales): overview KPIs, member flow and
snapshots, a retention cohort triangle, invite sources and inviter retention,
message volume by day and month, an hour-by-day-of-week heatmap, channel and
author rankings, recent messages, moderation actions and mod leaderboard,
application funnel and decision latency, modmail response times, voice sessions,
levels, movie nights, art jobs, and the security finding trend.

**Raw** one sheet per remaining table, with autofilter, freeze panes, banding and
per-column conditional formatting applied automatically.

**Reference** contents with hyperlinks, schema map with inferred column kinds,
tables deliberately not dumped, and run metadata.

## How it decides formatting

`introspect.py` infers a semantic *kind* per column from the column name, the
declared type, and a sample spread evenly across the rowid space. Kind then
drives the number format and the conditional formatting: numbers get data bars,
timestamps get a recency colour scale, booleans get green and grey fills, and
enums get discrete meaning colours from `theme.py`.

Two details matter more than they look:

- Sampling walks buckets across the whole rowid range rather than reading the
  first N rows. Several tables keep seed and test rows clustered at one end, and
  a head sample misreads them. `application` is the clear case: its first 250
  rows are 74 per cent fixtures.
- Identifier columns are never classified as enum, and always written as text.
  A Discord snowflake is 18 or 19 digits, and any numeric path lets Excel parse
  it as a float and silently drop the last digits.

## Layout

```
build_workbook.py   CLI and orchestration
introspect.py       schema discovery and column typing
writer.py           the one styled-sheet writer everything goes through
formats.py          cached xlsxwriter Format objects
theme.py            palette, shared with scripts/charts/theme.py
kinds.py            the column-kind vocabulary
raw.py              raw dump tier
toc.py              contents, schema map, run metadata
panels/             one module per analytics domain
```

Adding a panel means writing a `build(report, ctx)` function and registering it
in `panels/__init__.py`.

## Verification

The build self-checks and exits non-zero if anything is off:

- every sheet records rows written against the source `COUNT(*)`, and a mismatch
  that was not an intentional cap is reported as an error
- the finished workbook is opened as a zip and integrity checked
- panel failures are caught, logged, and surfaced rather than aborting the run

## Note on contents

The workbook contains message text, Discord user IDs and moderation reasons. It
is personal data. Keep it local unless it has been through a scrub pass.
