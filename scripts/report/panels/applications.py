"""Application funnel, outcomes and decision latency."""

import theme
from kinds import ENUM, INT, ISO_DT, REAL, SNOWFLAKE, TEXT
from panels._common import col, matrix_sheet, pivot, q, sheet

CATEGORY = "applications"


def build(report, ctx):
    guild = ctx["guild_id"]

    status = q(report, """
        SELECT status, COUNT(*) FROM application WHERE guild_id = ?
        GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    sheet(
        report, "Apps by Status",
        [col("Status", TEXT, 16), col("Applications", INT, 15)],
        status,
        category=CATEGORY,
        description="Current application outcomes.",
        chart={
            "type": "pie", "title": "Applications by status", "cat_col": 0,
            "series": [{"name": "Applications", "col": 1}],
        },
    )

    cells = q(report, """
        SELECT strftime('%Y-%m', created_at) AS m, status, COUNT(*)
        FROM application WHERE guild_id = ? AND strftime('%Y-%m', created_at) IS NOT NULL
        GROUP BY 1, 2
    """, (guild,))
    months = sorted({m for m, _s, _n in cells if m})
    statuses = sorted({s for _m, s, _n in cells})
    if months and statuses:
        grid = pivot([(m, s, n) for m, s, n in cells if m], months, statuses)
        matrix_sheet(
            report, "Apps by Month", months, statuses, grid,
            category=CATEGORY, corner="Month",
            description="Applications per month broken out by outcome.",
            note=(
                "Rows whose created_at is an epoch string rather than an ISO "
                "datetime are excluded here; about 7 per cent of the table is "
                "legacy data in that shape."
            ),
        )

    latency = q(report, """
        SELECT id, user_id, status, submitted_at, resolved_at, resolver_id,
               ROUND((julianday(resolved_at) - julianday(submitted_at)) * 24.0, 2)
        FROM application
        WHERE guild_id = ?
          AND submitted_at IS NOT NULL AND resolved_at IS NOT NULL
          AND julianday(resolved_at) IS NOT NULL
          AND julianday(submitted_at) IS NOT NULL
        ORDER BY 7 DESC
    """, (guild,))
    sheet(
        report, "Apps Decision Latency",
        [col("Application ID", TEXT, 38), col("User ID", SNOWFLAKE, 22),
         col("Status", TEXT, 14), col("Submitted", ISO_DT, 20),
         col("Resolved", ISO_DT, 20), col("Resolver ID", SNOWFLAKE, 22),
         col("Hours to Decide", REAL, 17)],
        latency,
        category=CATEGORY, freeze_col=1,
        description="Time from submission to resolution, slowest first.",
    )

    buckets = q(report, """
        SELECT CASE
                 WHEN h < 1 THEN 'under 1h'
                 WHEN h < 6 THEN '1h to 6h'
                 WHEN h < 24 THEN '6h to 24h'
                 WHEN h < 72 THEN '1d to 3d'
                 WHEN h < 168 THEN '3d to 7d'
                 ELSE 'over 7d'
               END AS bucket, COUNT(*)
        FROM (
          SELECT (julianday(resolved_at) - julianday(submitted_at)) * 24.0 AS h
          FROM application
          WHERE guild_id = ? AND submitted_at IS NOT NULL AND resolved_at IS NOT NULL
        )
        WHERE h IS NOT NULL
        GROUP BY 1
    """, (guild,))
    order = ["under 1h", "1h to 6h", "6h to 24h", "1d to 3d", "3d to 7d", "over 7d"]
    lookup = dict(buckets)
    ordered = [(b, lookup.get(b, 0)) for b in order]
    sheet(
        report, "Apps Latency Buckets",
        [col("Time to Decision", TEXT, 20), col("Applications", INT, 15)],
        ordered,
        category=CATEGORY,
        description="Distribution of how quickly applications get resolved.",
        chart={
            "type": "column", "title": "Time to decision", "cat_col": 0,
            "series": [{"name": "Applications", "col": 1, "color": theme.VIOLET}],
        },
    )
