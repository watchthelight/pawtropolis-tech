"""Avatar scanning, NSFW flags and the security audit trend."""

import theme
from kinds import BOOL, INT, ISO_DT, REAL, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, q, sheet

CATEGORY = "security"


def build(report, ctx):
    guild = ctx["guild_id"]

    flags = q(report, """
        SELECT flagged_at, user_id, nsfw_score, reason, flagged_by, reviewed,
               reviewed_by, reviewed_at
        FROM nsfw_flags WHERE guild_id = ? ORDER BY flagged_at DESC
    """, (guild,))
    sheet(
        report, "NSFW Flags",
        [col("Flagged At", ISO_DT, 20), col("User ID", SNOWFLAKE, 22),
         col("NSFW Score", REAL, 13), col("Reason", TEXT, 40),
         col("Flagged By", SNOWFLAKE, 22), col("Reviewed", BOOL, 10),
         col("Reviewed By", SNOWFLAKE, 22), col("Reviewed At", ISO_DT, 20)],
        flags,
        category=CATEGORY, freeze_col=1,
        description="Every NSFW flag raised, newest first.",
    )

    buckets = q(report, """
        SELECT CASE
                 WHEN nsfw_score < 0.1 THEN '0.0 to 0.1'
                 WHEN nsfw_score < 0.3 THEN '0.1 to 0.3'
                 WHEN nsfw_score < 0.5 THEN '0.3 to 0.5'
                 WHEN nsfw_score < 0.7 THEN '0.5 to 0.7'
                 WHEN nsfw_score < 0.9 THEN '0.7 to 0.9'
                 ELSE '0.9 to 1.0'
               END AS bucket,
               COUNT(*), SUM(CASE WHEN flagged = 1 THEN 1 ELSE 0 END)
        FROM avatar_scan WHERE nsfw_score IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)
    sheet(
        report, "Avatar Scan Scores",
        [col("NSFW Score Range", TEXT, 18), col("Scans", INT), col("Flagged", INT)],
        buckets,
        category=CATEGORY,
        description="Distribution of automated avatar NSFW scores.",
        chart={
            "type": "column", "title": "Avatar scan score distribution", "cat_col": 0,
            "series": [
                {"name": "Scans", "col": 1, "color": theme.ACCENT},
                {"name": "Flagged", "col": 2, "color": theme.DANGER},
            ],
        },
    )

    trend = q(report, """
        SELECT date(recorded_at, 'unixepoch') AS d,
               MAX(critical_count), MAX(high_count), MAX(medium_count),
               MAX(low_count), MAX(acknowledged_count)
        FROM security_issue_history WHERE guild_id = ?
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Security Issue Trend",
        [col("Date", TEXT, 12), col("Critical", INT), col("High", INT),
         col("Medium", INT), col("Low", INT), col("Acknowledged", INT, 15)],
        trend,
        category=CATEGORY,
        description="Daily peak of open security audit findings by severity.",
        chart={
            "type": "line", "title": "Open security findings over time", "cat_col": 0,
            "series": [
                {"name": "Critical", "col": 1, "color": theme.DANGER},
                {"name": "High", "col": 2, "color": theme.ORANGE},
                {"name": "Medium", "col": 3, "color": theme.WARN},
                {"name": "Low", "col": 4, "color": theme.GREY},
            ],
            "width": 900,
        },
    )
