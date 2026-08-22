"""Levels, movie nights, art jobs and Patreon rewards."""

import theme
from kinds import BOOL, INT, ISO_DT, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, q, sheet

CATEGORY = "economy"


def build(report, ctx):
    guild = ctx["guild_id"]

    by_level = q(report, """
        SELECT level, COUNT(*), COUNT(DISTINCT user_id),
               MIN(granted_at_s), MAX(granted_at_s)
        FROM level_reward_granted WHERE guild_id = ?
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Levels by Tier",
        [col("Level", INT, 10), col("Grants", INT), col("Distinct Users", INT, 15),
         col("First Grant", UNIX_TS, 20), col("Last Grant", UNIX_TS, 20)],
        by_level,
        category=CATEGORY,
        description="Level reward grants per tier.",
        chart={
            "type": "column", "title": "Level reward grants by tier", "cat_col": 0,
            "series": [{"name": "Grants", "col": 1, "color": theme.PINK}],
        },
    )

    by_month = q(report, """
        SELECT strftime('%Y-%m', granted_at_s, 'unixepoch') AS m,
               COUNT(*), COUNT(DISTINCT user_id)
        FROM level_reward_granted WHERE guild_id = ?
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Levels by Month",
        [col("Month", TEXT, 12), col("Grants", INT), col("Distinct Users", INT, 15)],
        by_month,
        category=CATEGORY,
        description="Level reward activity over time.",
        chart={
            "type": "line", "title": "Level grants per month", "cat_col": 0,
            "series": [{"name": "Grants", "col": 1, "color": theme.PINK}],
        },
    )

    movies = q(report, """
        SELECT event_date, event_type, COUNT(*),
               SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END),
               ROUND(AVG(duration_minutes), 1)
        FROM movie_attendance WHERE guild_id = ?
        GROUP BY 1, 2 ORDER BY 1 DESC
    """, (guild,))
    sheet(
        report, "Movie Attendance",
        [col("Event Date", TEXT, 14), col("Event Type", TEXT, 14),
         col("Attendees", INT), col("Qualified", INT), col("Avg Minutes", INT, 14)],
        movies,
        category=CATEGORY,
        description="Movie and game night attendance per event.",
    )

    art = q(report, """
        SELECT status, ticket_type, COUNT(*), COUNT(DISTINCT artist_id)
        FROM art_job WHERE guild_id = ? GROUP BY 1, 2 ORDER BY 3 DESC
    """, (guild,))
    sheet(
        report, "Art Jobs",
        [col("Status", TEXT, 16), col("Ticket Type", TEXT, 18), col("Jobs", INT),
         col("Distinct Artists", INT, 17)],
        art,
        category=CATEGORY,
        description="Art job pipeline by state and ticket type.",
    )

    patreon = q(report, """
        SELECT user_id, art_type, quantity_granted, last_granted_at_s
        FROM patreon_art_granted WHERE guild_id = ? ORDER BY 4 DESC
    """, (guild,))
    sheet(
        report, "Patreon Art Grants",
        [col("User ID", SNOWFLAKE, 22), col("Art Type", TEXT, 18),
         col("Quantity Granted", INT, 18), col("Last Granted", UNIX_TS, 20)],
        patreon,
        category=CATEGORY, freeze_col=1,
        description="Patreon art ticket grants.",
        note=(
            "quantity_redeemed is absent from this snapshot because migration 081 "
            "has not been applied to production."
        ),
    )
