"""Moderation activity: action log, reviewer workload, review actions."""

import theme
from kinds import INT, REAL, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, matrix_sheet, pivot, q, sheet

CATEGORY = "moderation"
TOP_ACTIONS = 12


def _display_names(report):
    """Resolve moderator ids to names, preferring user_names over user_cache.

    Mirrors the fallback used by scripts/charts/pull.js.
    """
    names = {}
    for uid, username in q(report, "SELECT user_id, username FROM user_cache"):
        if username:
            names.setdefault(uid, username)
    for uid, display, username in q(
        report, "SELECT id, display, username FROM user_names"
    ):
        chosen = display or username
        if chosen:
            names[uid] = chosen
    return names


def build(report, ctx):
    guild = ctx["guild_id"]
    names = _display_names(report)

    by_action = q(report, """
        SELECT action, COUNT(*), MIN(created_at_s), MAX(created_at_s)
        FROM action_log WHERE guild_id = ? GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    sheet(
        report, "Mod Actions",
        [col("Action", TEXT, 26), col("Count", INT), col("First Seen", UNIX_TS, 20),
         col("Last Seen", UNIX_TS, 20)],
        by_action,
        category=CATEGORY,
        description="Every distinct action recorded in action_log, by frequency.",
        chart={
            "type": "bar", "title": "Actions by type", "cat_col": 0,
            "series": [{"name": "Count", "col": 1, "color": theme.WARN}],
        },
    )

    top = [a for a, _c, _f, _l in by_action[:TOP_ACTIONS]]
    if top:
        placeholders = ", ".join("?" for _ in top)
        cells = q(report, """
            SELECT strftime('%%Y-%%m', created_at_s, 'unixepoch') AS m, action, COUNT(*)
            FROM action_log WHERE guild_id = ? AND action IN (%s)
            GROUP BY 1, 2
        """ % placeholders, (guild, *top))
        months = sorted({m for m, _a, _n in cells})
        grid = pivot(cells, months, top)
        matrix_sheet(
            report, "Mod Actions by Month", months, top, grid,
            category=CATEGORY, corner="Month",
            description="Monthly volume for the most common moderation actions.",
        )

    leaderboard = q(report, """
        SELECT moderator_id, total_claims, total_accepts, total_rejects, total_kicks,
               total_modmail_opens, avg_response_time_s, p50_response_time_s,
               p95_response_time_s, updated_at
        FROM mod_metrics WHERE guild_id = ?
        ORDER BY total_claims DESC
    """, (guild,))
    rows = [
        (names.get(mid, "(unknown)"), mid, claims, accepts, rejects, kicks, opens,
         avg_s, p50, p95, updated)
        for (mid, claims, accepts, rejects, kicks, opens, avg_s, p50, p95, updated)
        in leaderboard
    ]
    sheet(
        report, "Mod Leaderboard",
        [col("Moderator", TEXT, 24), col("Moderator ID", SNOWFLAKE, 22),
         col("Claims", INT), col("Accepts", INT), col("Rejects", INT),
         col("Kicks", INT), col("Modmail Opens", INT, 16),
         col("Avg Response (s)", REAL, 18), col("p50 (s)", REAL, 12),
         col("p95 (s)", REAL, 12), col("Updated", TEXT, 20)],
        rows,
        category=CATEGORY, freeze_col=1,
        description="Per-moderator workload and response latency from mod_metrics.",
        chart={
            "type": "bar", "title": "Claims by moderator", "cat_col": 0,
            "series": [{"name": "Claims", "col": 2, "color": theme.VIOLET}],
        },
    )

    review = q(report, """
        SELECT action, COUNT(*), COUNT(DISTINCT moderator_id),
               MIN(created_at), MAX(created_at)
        FROM review_action GROUP BY 1 ORDER BY 2 DESC
    """)
    sheet(
        report, "Review Actions",
        [col("Action", TEXT, 26), col("Count", INT), col("Distinct Mods", INT, 15),
         col("First", UNIX_TS, 20), col("Last", UNIX_TS, 20)],
        review,
        category=CATEGORY,
        description="Aggregate of the review_action audit trail.",
    )
