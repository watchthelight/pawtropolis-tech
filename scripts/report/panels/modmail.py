"""Modmail ticket volume and first-response latency."""

import theme
from kinds import INT, ISO_DT, REAL, SNOWFLAKE, TEXT
from panels._common import col, q, sheet

CATEGORY = "modmail"


def build(report, ctx):
    guild = ctx["guild_id"]

    monthly = q(report, """
        SELECT strftime('%Y-%m', created_at) AS m, COUNT(*),
               SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END)
        FROM modmail_ticket WHERE guild_id = ?
        GROUP BY 1 HAVING m IS NOT NULL ORDER BY 1
    """, (guild,))
    sheet(
        report, "Modmail by Month",
        [col("Month", TEXT, 12), col("Tickets Opened", INT, 16), col("Closed", INT)],
        monthly,
        category=CATEGORY,
        description="Modmail tickets opened per month, and how many have been closed.",
        chart={
            "type": "column", "title": "Modmail tickets per month", "cat_col": 0,
            "series": [
                {"name": "Opened", "col": 1, "color": theme.TEAL},
                {"name": "Closed", "col": 2, "color": theme.GREY},
            ],
        },
    )

    status = q(report, """
        SELECT status, COUNT(*) FROM modmail_ticket WHERE guild_id = ?
        GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    sheet(
        report, "Modmail by Status",
        [col("Status", TEXT, 16), col("Tickets", INT)],
        status,
        category=CATEGORY,
        description="Ticket states.",
        chart={
            "type": "pie", "title": "Tickets by status", "cat_col": 0,
            "series": [{"name": "Tickets", "col": 1}],
        },
    )

    # First-response latency: gap between the ticket opening and its first logged
    # message. Mirrors the correlated subquery in scripts/charts/pull.js.
    latency = q(report, """
        SELECT mt.id, mt.user_id, mt.status, mt.created_at,
               (SELECT MIN(mm.created_at) FROM modmail_message mm
                 WHERE mm.ticket_id = mt.id) AS first_msg,
               ROUND((julianday(
                   (SELECT MIN(mm.created_at) FROM modmail_message mm
                     WHERE mm.ticket_id = mt.id)
               ) - julianday(mt.created_at)) * 1440.0, 1) AS minutes
        FROM modmail_ticket mt
        WHERE mt.guild_id = ?
        ORDER BY minutes DESC
    """, (guild,))
    sheet(
        report, "Modmail Response Time",
        [col("Ticket", INT, 10), col("User ID", SNOWFLAKE, 22), col("Status", TEXT, 14),
         col("Opened", ISO_DT, 20), col("First Message", ISO_DT, 20),
         col("Minutes to First Msg", REAL, 21)],
        latency,
        category=CATEGORY, freeze_col=1,
        description="Latency from ticket open to first message, slowest first.",
        note="Blank latency means the ticket has no messages recorded.",
    )
