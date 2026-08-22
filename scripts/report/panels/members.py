"""Member growth, churn and retention cohorts."""

from datetime import datetime, timezone

import theme
from kinds import INT, ISO_DT, REAL, TEXT
from panels._common import col, matrix_sheet, q, sheet

CATEGORY = "members"
MAX_COHORT_OFFSET = 24


def _month_index(ts):
    stamp = datetime.fromtimestamp(ts, tz=timezone.utc)
    return stamp.year * 12 + (stamp.month - 1)


def _month_label(index):
    return "%04d-%02d" % (index // 12, index % 12 + 1)


def build(report, ctx):
    guild = ctx["guild_id"]

    joins = dict(q(report, """
        SELECT strftime('%Y-%m', joined_at, 'unixepoch') AS m, COUNT(*)
        FROM user_activity WHERE guild_id = ? AND joined_at IS NOT NULL
        GROUP BY 1
    """, (guild,)))
    leaves = dict(q(report, """
        SELECT strftime('%Y-%m', left_at, 'unixepoch') AS m, COUNT(*)
        FROM user_activity WHERE guild_id = ? AND left_at IS NOT NULL
        GROUP BY 1
    """, (guild,)))

    months = sorted(set(joins) | set(leaves))
    running = 0
    flow = []
    for month in months:
        joined = joins.get(month, 0)
        left = leaves.get(month, 0)
        running += joined - left
        flow.append((month, joined, left, joined - left, running))

    sheet(
        report, "Members Flow",
        [col("Month", TEXT, 12), col("Joined", INT), col("Left", INT),
         col("Net", INT), col("Cumulative", INT, 14)],
        flow,
        category=CATEGORY,
        description="Joins and leaves per month from user_activity, with a running net total.",
        chart={
            "type": "column", "subtype": "stacked", "title": "Joins and leaves per month",
            "cat_col": 0,
            "series": [
                {"name": "Joined", "col": 1, "color": theme.SUCCESS},
                {"name": "Left", "col": 2, "color": theme.DANGER},
            ],
        },
    )

    snapshots = q(report, """
        SELECT date, member_count, online_count, boost_count, boost_tier, voice_users_now
        FROM guild_snapshot_log WHERE guild_id = ? ORDER BY date
    """, (guild,))
    if snapshots:
        sheet(
            report, "Members Snapshots",
            [col("Date", TEXT, 12), col("Members", INT), col("Online", INT),
             col("Boosts", INT), col("Boost Tier", INT), col("In Voice", INT)],
            snapshots,
            category=CATEGORY,
            description="Point-in-time guild snapshots recorded by the bot scheduler.",
            chart={
                "type": "line", "title": "Member count over time", "cat_col": 0,
                "series": [{"name": "Members", "col": 1, "color": theme.ACCENT}],
            },
        )

    _cohorts(report, guild, ctx)


def _cohorts(report, guild, ctx):
    """Classic retention triangle: cohort month by months elapsed since joining."""
    rows = q(report, """
        SELECT joined_at, left_at FROM user_activity
        WHERE guild_id = ? AND joined_at IS NOT NULL
    """, (guild,))
    if not rows:
        return

    now_index = _month_index(ctx["now"])
    sizes = {}
    lifetimes = {}
    for joined_at, left_at in rows:
        try:
            cohort = _month_index(joined_at)
        except (OverflowError, OSError, ValueError):
            continue
        if left_at:
            try:
                lifetime = _month_index(left_at) - cohort
            except (OverflowError, OSError, ValueError):
                lifetime = now_index - cohort
        else:
            lifetime = now_index - cohort
        sizes[cohort] = sizes.get(cohort, 0) + 1
        lifetimes.setdefault(cohort, []).append(max(0, lifetime))

    cohort_keys = sorted(sizes)
    row_labels = ["%s  (n=%d)" % (_month_label(k), sizes[k]) for k in cohort_keys]
    col_labels = ["M%d" % m for m in range(MAX_COHORT_OFFSET + 1)]

    grid = []
    for key in cohort_keys:
        spans = lifetimes[key]
        size = sizes[key]
        line = []
        for offset in range(MAX_COHORT_OFFSET + 1):
            if key + offset > now_index:
                line.append(None)
                continue
            retained = sum(1 for s in spans if s >= offset)
            line.append(round(100.0 * retained / size, 1) if size else None)
        grid.append(line)

    matrix_sheet(
        report, "Members Retention", row_labels, col_labels, grid,
        category=CATEGORY, corner="Cohort",
        description=(
            "Percent of each join-month cohort still in the guild after N months. "
            "Cells past the present are blank, which is what gives the triangle."
        ),
        note="Derived from user_activity.joined_at and left_at.",
        number_format='0.0"%"',
    )
