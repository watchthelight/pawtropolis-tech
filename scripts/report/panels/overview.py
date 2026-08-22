"""KPI dashboard: the one sheet that answers "how big is this server"."""

from datetime import datetime, timezone

import theme
from kinds import INT, TEXT
from panels._common import add_chart, col, kpi_grid, one, q, sheet

CATEGORY = "overview"


def _stamp(ts):
    if not ts:
        return "n/a"
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def build(report, ctx):
    guild = ctx["guild_id"]
    conn_args = (guild,)

    total_messages = one(report, "SELECT COUNT(*) FROM messages_archive WHERE guild_id = ?", conn_args)
    distinct_authors = one(report, "SELECT COUNT(DISTINCT author_id) FROM messages_archive WHERE guild_id = ?", conn_args)
    first_msg = one(report, "SELECT MIN(created_at_s) FROM messages_archive WHERE guild_id = ?", conn_args)
    last_msg = one(report, "SELECT MAX(created_at_s) FROM messages_archive WHERE guild_id = ?", conn_args)
    channels = one(report, "SELECT COUNT(DISTINCT channel_id) FROM messages_archive WHERE guild_id = ?", conn_args)

    members_seen = one(report, "SELECT COUNT(*) FROM user_activity WHERE guild_id = ?", conn_args)
    members_now = one(report, "SELECT COUNT(*) FROM user_activity WHERE guild_id = ? AND left_at IS NULL", conn_args)
    latest_snapshot = one(report, "SELECT member_count FROM guild_snapshot_log WHERE guild_id = ? ORDER BY date DESC LIMIT 1", conn_args)

    apps_total = one(report, "SELECT COUNT(*) FROM application WHERE guild_id = ?", conn_args)
    apps_approved = one(report, "SELECT COUNT(*) FROM application WHERE guild_id = ? AND status = 'approved'", conn_args)
    apps_rejected = one(report, "SELECT COUNT(*) FROM application WHERE guild_id = ? AND status = 'rejected'", conn_args)

    mod_actions = one(report, "SELECT COUNT(*) FROM action_log WHERE guild_id = ?", conn_args)
    review_actions = one(report, "SELECT COUNT(*) FROM review_action")
    tickets = one(report, "SELECT COUNT(*) FROM modmail_ticket WHERE guild_id = ?", conn_args)
    voice_minutes = one(report, """
        SELECT ROUND(SUM(MAX(left_at_s - joined_at_s, 0)) / 60.0)
        FROM voice_session WHERE guild_id = ? AND left_at_s IS NOT NULL
    """, conn_args)
    flags = one(report, "SELECT COUNT(*) FROM nsfw_flags WHERE guild_id = ?", conn_args)
    level_grants = one(report, "SELECT COUNT(*) FROM level_reward_granted WHERE guild_id = ?", conn_args)

    ws = report.wb.add_worksheet(report.sheet_name("Overview"))
    ws.set_tab_color(theme.CATEGORY_COLOR[CATEGORY])
    ws.hide_gridlines(2)
    ws.write_string(0, 0, "Pawtropolis Server Report", report.fmts.title())
    ws.write_string(
        1, 0,
        "Guild %s   |   data from %s to %s" % (guild, _stamp(first_msg), _stamp(last_msg)),
        report.fmts.subtitle(),
    )

    cards = [
        {"label": "Messages archived", "value": total_messages, "color": theme.SUCCESS},
        {"label": "Distinct authors", "value": distinct_authors},
        {"label": "Channels used", "value": channels},
        {"label": "Members ever seen", "value": members_seen, "color": theme.INFO},
        {"label": "Members present", "value": members_now, "color": theme.INFO},
        {"label": "Latest snapshot count", "value": latest_snapshot or 0},
        {"label": "Applications", "value": apps_total, "color": theme.VIOLET},
        {"label": "Approved", "value": apps_approved, "color": theme.SUCCESS},
        {"label": "Rejected", "value": apps_rejected, "color": theme.DANGER},
        {"label": "Moderation actions", "value": mod_actions, "color": theme.WARN},
        {"label": "Review actions", "value": review_actions, "color": theme.WARN},
        {"label": "Modmail tickets", "value": tickets, "color": theme.TEAL},
        {"label": "Voice minutes", "value": int(voice_minutes or 0), "color": theme.ORANGE},
        {"label": "Level rewards granted", "value": level_grants, "color": theme.PINK},
        {"label": "NSFW flags", "value": flags, "color": theme.DANGER},
        {"label": "Days of history", "value": int(((last_msg or 0) - (first_msg or 0)) / 86400)},
    ]
    next_row = kpi_grid(report, ws, cards, start_row=3, per_row=4)

    yearly = q(report, """
        SELECT strftime('%Y', created_at_s, 'unixepoch') AS y, COUNT(*)
        FROM messages_archive WHERE guild_id = ? GROUP BY 1 ORDER BY 1
    """, conn_args)
    anchor_row = next_row + 1
    ws.write_string(anchor_row, 0, "Messages per year", report.fmts.section())
    start = anchor_row + 1
    header = report.fmts.header()
    ws.write_string(start, 0, "Year", header)
    ws.write_string(start, 1, "Messages", header)
    body = report.fmts.cell(INT)
    label = report.fmts.cell(TEXT)
    for offset, (year, count) in enumerate(yearly):
        ws.write_string(start + 1 + offset, 0, str(year), label)
        ws.write_number(start + 1 + offset, 1, count, body)
    if yearly:
        ws.conditional_format(start + 1, 1, start + len(yearly), 1, {
            "type": "data_bar", "bar_color": theme.SUCCESS, "bar_solid": False,
        })
        chart = report.wb.add_chart({"type": "column"})
        chart.add_series({
            "name": "Messages",
            "categories": [ws.get_name(), start + 1, 0, start + len(yearly), 0],
            "values": [ws.get_name(), start + 1, 1, start + len(yearly), 1],
            "fill": {"color": theme.SUCCESS},
            "border": {"none": True},
        })
        chart.set_title({"name": "Messages per year",
                         "name_font": {"size": 12, "bold": True, "color": theme.HEADER_BG}})
        chart.set_legend({"none": True})
        chart.set_chartarea({"border": {"color": theme.BORDER}, "fill": {"color": "#FFFFFF"}})
        chart.set_size({"width": 620, "height": 320})
        ws.insert_chart(start, 3, chart)

    report.record(ws.get_name(), CATEGORY, "Headline counts for the whole server.",
                  len(cards), len(cards), "")
    ctx["kpis"] = {
        "messages": total_messages, "members_seen": members_seen,
        "applications": apps_total, "first_msg": first_msg, "last_msg": last_msg,
    }
    return ws
