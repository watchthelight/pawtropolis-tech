"""Invite sources and how well each inviter's recruits stick."""

import theme
from kinds import INT, REAL, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, q, sheet

CATEGORY = "members"


def build(report, ctx):
    guild = ctx["guild_id"]

    codes = q(report, """
        SELECT invite_code, COUNT(*), COUNT(DISTINCT inviter_id),
               MIN(joined_at_s), MAX(joined_at_s)
        FROM invite_usage WHERE guild_id = ?
        GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    sheet(
        report, "Invite Codes",
        [col("Invite Code", TEXT, 20), col("Uses", INT), col("Distinct Inviters", INT, 18),
         col("First Use", UNIX_TS, 20), col("Last Use", UNIX_TS, 20)],
        codes,
        category=CATEGORY,
        description="Invite codes ranked by how many joins they produced.",
        chart={
            "type": "bar", "title": "Top invite codes", "cat_col": 0,
            "series": [{"name": "Uses", "col": 1, "color": theme.INFO}],
        },
    )

    inviters = q(report, """
        SELECT iu.inviter_id,
               COUNT(*) AS invited,
               SUM(CASE WHEN ua.user_id IS NOT NULL AND ua.left_at IS NULL
                        THEN 1 ELSE 0 END) AS still_here,
               ROUND(100.0 * SUM(CASE WHEN ua.user_id IS NOT NULL AND ua.left_at IS NULL
                                      THEN 1 ELSE 0 END) / COUNT(*), 1) AS retention_pct,
               MAX(iu.joined_at_s)
        FROM invite_usage iu
        LEFT JOIN user_activity ua
               ON ua.user_id = iu.user_id AND ua.guild_id = iu.guild_id
        WHERE iu.guild_id = ? AND iu.inviter_id IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    sheet(
        report, "Inviter Retention",
        [col("Inviter ID", SNOWFLAKE, 22), col("Members Invited", INT, 17),
         col("Still In Guild", INT, 16), col("Retention %", REAL, 14),
         col("Most Recent Invite", UNIX_TS, 21)],
        inviters,
        category=CATEGORY, freeze_col=1,
        description="Per-inviter recruit count and how many of those recruits remain.",
        note="Retention is measured against user_activity.left_at being null.",
    )
