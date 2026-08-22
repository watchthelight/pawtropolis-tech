"""Message volume: daily, monthly, by hour of week, by channel, by author."""

import theme
from kinds import BOOL, INT, SNOWFLAKE, TEXT, UNIX_TS
from panels._common import col, matrix_sheet, pivot, q, sheet

CATEGORY = "messages"

DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def _channel_names(report, guild):
    return {
        cid: name for cid, name in q(
            report, "SELECT channel_id, name FROM channel_cache WHERE guild_id = ?",
            (guild,),
        )
    }


def build(report, ctx):
    guild = ctx["guild_id"]
    names = _channel_names(report, guild)

    daily = q(report, """
        SELECT date(created_at_s, 'unixepoch') AS d,
               COUNT(*),
               COUNT(DISTINCT author_id),
               SUM(CASE WHEN author_is_bot = 1 THEN 1 ELSE 0 END)
        FROM messages_archive WHERE guild_id = ?
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Msgs by Day",
        [col("Date", TEXT, 12), col("Messages", INT), col("Distinct Authors", INT, 18),
         col("Bot Messages", INT, 14)],
        daily,
        category=CATEGORY,
        description="Daily message volume across the whole archive.",
        chart={
            "type": "line", "title": "Messages per day", "cat_col": 0,
            "series": [{"name": "Messages", "col": 1, "color": theme.SUCCESS}],
            "width": 900,
        },
    )

    monthly = q(report, """
        SELECT strftime('%Y-%m', created_at_s, 'unixepoch') AS m,
               COUNT(*), COUNT(DISTINCT author_id), COUNT(DISTINCT channel_id)
        FROM messages_archive WHERE guild_id = ?
        GROUP BY 1 ORDER BY 1
    """, (guild,))
    sheet(
        report, "Msgs by Month",
        [col("Month", TEXT, 12), col("Messages", INT), col("Distinct Authors", INT, 18),
         col("Active Channels", INT, 16)],
        monthly,
        category=CATEGORY,
        description="Monthly totals with distinct author and channel breadth.",
        chart={
            "type": "column", "title": "Messages per month", "cat_col": 0,
            "series": [{"name": "Messages", "col": 1, "color": theme.ACCENT}],
            "width": 900,
        },
    )

    heat = q(report, """
        SELECT CAST(strftime('%w', created_at_s, 'unixepoch') AS INTEGER),
               CAST(strftime('%H', created_at_s, 'unixepoch') AS INTEGER),
               COUNT(*)
        FROM messages_archive WHERE guild_id = ? GROUP BY 1, 2
    """, (guild,))
    hours = list(range(24))
    grid = pivot([(h, d, n) for d, h, n in heat], hours, list(range(7)))
    matrix_sheet(
        report, "Msgs Hour x Day", ["%02d:00" % h for h in hours], DOW, grid,
        category=CATEGORY, corner="Hour (UTC)",
        description="Message density by hour of day and day of week, across all history.",
        note="Times are UTC, matching how the bot stores created_at_s.",
    )

    channels = q(report, """
        SELECT channel_id, COUNT(*), COUNT(DISTINCT author_id),
               MIN(created_at_s), MAX(created_at_s)
        FROM messages_archive WHERE guild_id = ?
        GROUP BY 1 ORDER BY 2 DESC
    """, (guild,))
    channel_rows = [
        (names.get(cid, "(unknown)"), cid, total, authors, first, last)
        for cid, total, authors, first, last in channels
    ]
    sheet(
        report, "Msgs by Channel",
        [col("Channel", TEXT, 30), col("Channel ID", SNOWFLAKE, 22),
         col("Messages", INT), col("Distinct Authors", INT, 18),
         col("First Message", UNIX_TS, 20), col("Last Message", UNIX_TS, 20)],
        channel_rows,
        category=CATEGORY, freeze_col=1,
        description="Every channel that has ever carried a message, ranked by volume.",
        chart={
            "type": "bar", "title": "Top channels by messages", "cat_col": 0,
            "series": [{"name": "Messages", "col": 2, "color": theme.TEAL}],
        },
    )

    authors = q(report, """
        SELECT author_id, author_name, COUNT(*), COUNT(DISTINCT channel_id),
               MIN(created_at_s), MAX(created_at_s), MAX(author_is_bot)
        FROM messages_archive WHERE guild_id = ?
        GROUP BY 1 ORDER BY 3 DESC LIMIT ?
    """, (guild, ctx["args"].top_authors))
    sheet(
        report, "Msgs by Author",
        [col("Author ID", SNOWFLAKE, 22), col("Author", TEXT, 26),
         col("Messages", INT), col("Channels Used", INT, 15),
         col("First Message", UNIX_TS, 20), col("Last Message", UNIX_TS, 20),
         col("Is Bot", BOOL, 9)],
        authors,
        category=CATEGORY, freeze_col=2,
        description="Top authors by lifetime message count.",
        note="Capped at --top-authors.",
    )

    limit = ctx["args"].recent_messages
    recent = q(report, """
        SELECT created_at_s, author_name, author_id, channel_id, content,
               is_edited, is_deleted, message_id
        FROM messages_archive WHERE guild_id = ?
        ORDER BY created_at_s DESC LIMIT ?
    """, (guild, limit))
    recent_rows = [
        (ts, author, aid, names.get(cid, cid), content, edited, deleted, mid)
        for ts, author, aid, cid, content, edited, deleted, mid in recent
    ]
    total_messages = report.conn.execute(
        "SELECT COUNT(*) FROM messages_archive WHERE guild_id = ?", (guild,)
    ).fetchone()[0]
    sheet(
        report, "Msgs Recent",
        [col("Sent", UNIX_TS, 20), col("Author", TEXT, 22), col("Author ID", SNOWFLAKE, 22),
         col("Channel", TEXT, 24), col("Content", TEXT, 80), col("Edited", BOOL, 9),
         col("Deleted", BOOL, 9), col("Message ID", SNOWFLAKE, 22)],
        recent_rows,
        category=CATEGORY, freeze_col=1,
        expected=total_messages,
        description="Most recent messages, newest first.",
        note=(
            "Sample of the %s message archive, capped at %s rows by --recent-messages. "
            "The archive is far past the Excel sheet limit, so the full table is "
            "represented by the aggregate sheets instead."
            % ("{:,}".format(total_messages), "{:,}".format(limit))
        ),
    )
