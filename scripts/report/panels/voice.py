"""Voice session volume, duration distribution and top users."""

import theme
from kinds import INT, REAL, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, q, sheet

CATEGORY = "voice"


def build(report, ctx):
    guild = ctx["guild_id"]

    monthly = q(report, """
        SELECT strftime('%Y-%m', joined_at_s, 'unixepoch') AS m,
               COUNT(*), COUNT(DISTINCT user_id),
               ROUND(SUM(MAX(left_at_s - joined_at_s, 0)) / 60.0, 1)
        FROM voice_session
        WHERE guild_id = ? AND left_at_s IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Voice by Month",
        [col("Month", TEXT, 12), col("Sessions", INT), col("Distinct Users", INT, 15),
         col("Total Minutes", REAL, 15)],
        monthly,
        category=CATEGORY,
        description="Voice session count and total minutes per month.",
        chart={
            "type": "column", "title": "Voice minutes per month", "cat_col": 0,
            "series": [{"name": "Minutes", "col": 3, "color": theme.ORANGE}],
        },
    )

    buckets = q(report, """
        SELECT CASE
                 WHEN mins < 1 THEN 'under 1 min'
                 WHEN mins < 5 THEN '1 to 5 min'
                 WHEN mins < 15 THEN '5 to 15 min'
                 WHEN mins < 60 THEN '15 to 60 min'
                 WHEN mins < 180 THEN '1 to 3 hours'
                 ELSE 'over 3 hours'
               END AS bucket, COUNT(*)
        FROM (
          SELECT (left_at_s - joined_at_s) / 60.0 AS mins
          FROM voice_session WHERE guild_id = ? AND left_at_s IS NOT NULL
        )
        WHERE mins >= 0
        GROUP BY 1
    """, (guild,))
    order = ["under 1 min", "1 to 5 min", "5 to 15 min", "15 to 60 min",
             "1 to 3 hours", "over 3 hours"]
    lookup = dict(buckets)
    sheet(
        report, "Voice Durations",
        [col("Session Length", TEXT, 18), col("Sessions", INT)],
        [(b, lookup.get(b, 0)) for b in order],
        category=CATEGORY,
        description="How long voice sessions actually last.",
        chart={
            "type": "column", "title": "Session length distribution", "cat_col": 0,
            "series": [{"name": "Sessions", "col": 1, "color": theme.ORANGE}],
        },
    )

    top = q(report, """
        SELECT user_id, COUNT(*),
               ROUND(SUM(MAX(left_at_s - joined_at_s, 0)) / 60.0, 1),
               MIN(joined_at_s), MAX(joined_at_s)
        FROM voice_session WHERE guild_id = ? AND left_at_s IS NOT NULL
        GROUP BY 1 ORDER BY 3 DESC
    """, (guild,))
    sheet(
        report, "Voice Top Users",
        [col("User ID", SNOWFLAKE, 22), col("Sessions", INT),
         col("Total Minutes", REAL, 15), col("First Seen", UNIX_TS, 20),
         col("Last Seen", UNIX_TS, 20)],
        top,
        category=CATEGORY, freeze_col=1,
        description="Users ranked by total voice minutes.",
    )
