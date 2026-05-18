"""Render all 20 chart PNGs from _charts_data.json into _charts_out/."""
import json, os, sys, datetime as dt, math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.dates import DateFormatter, MonthLocator
from matplotlib.patches import Rectangle
from matplotlib.colors import LinearSegmentedColormap

sys.path.insert(0, os.path.dirname(__file__))
from theme import (BG, PANEL, GRID, TEXT, MUTED, FAINT, ACCENT, SUCCESS, WARN,
                   DANGER, SECONDARY, PALETTE, style_axes, dark_fig, title,
                   footer, save, rolling)

DATA_PATH = "_charts_data.json"
OUT = "_charts_out"
os.makedirs(OUT, exist_ok=True)

with open(DATA_PATH, encoding="utf-8") as f:
    D = json.load(f)

NOW = dt.datetime.fromisoformat(D["nowISO"].replace("Z", "+00:00"))


def parse_dates(seq, key="date"):
    return [dt.date.fromisoformat(r[key]) for r in seq]


# ───────────────────────────────────────────── 1. Member count over time
def chart_01_members():
    rows = D["memberCount"]
    if not rows:
        return print("01 members: no data")
    dates = [dt.date.fromisoformat(r["date"]) for r in rows]
    members = [r["members"] for r in rows]
    online = [r["online"] for r in rows]
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.fill_between(dates, members, color=ACCENT, alpha=0.18, linewidth=0)
    ax.plot(dates, members, color=ACCENT, linewidth=2.2, label="members")
    ax.plot(dates, online, color=SUCCESS, linewidth=1.2, alpha=0.9, label="online")
    title(ax, "Member count over time",
          f"snapshot log · {dates[0]} → {dates[-1]} · {len(dates)} days")
    ax.set_ylabel("members", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="lower right", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b '%y"))
    footer(fig, f"current {members[-1]:,} · {members[-1] - members[0]:+,} since {dates[0]}")
    save(fig, f"{OUT}/01_member_count.png")
    print(f"01 ok — {len(dates)} pts, latest {members[-1]:,}")


# ───────────────────────────────────────────── 2. Joins vs leaves daily
def chart_02_joins_leaves():
    rows = D["joinsLeaves"]
    if not rows:
        return print("02 joins/leaves: no data")
    dates = parse_dates(rows)
    joins = [r["joins"] for r in rows]
    leaves = [-r["leaves"] for r in rows]
    net = np.cumsum([r["joins"] - r["leaves"] for r in rows])
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax2 = ax.twinx()
    style_axes(ax2)
    ax2.grid(False)
    ax.bar(dates, joins, color=SUCCESS, alpha=0.85, width=1.0, label="joins")
    ax.bar(dates, leaves, color=DANGER, alpha=0.85, width=1.0, label="leaves")
    ax.axhline(0, color=GRID, linewidth=0.6)
    ax2.plot(dates, net, color=WARN, linewidth=1.8, label="cumulative net")
    ax2.set_ylabel("cumulative net joins", color=WARN)
    ax2.tick_params(colors=WARN)
    ax.set_ylabel("daily count", color=TEXT)
    title(ax, "Joins vs leaves (daily, last 180d)",
          "green = joined, red = left, gold = cumulative net")
    ax.xaxis.set_major_formatter(DateFormatter("%b '%y"))
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    total_j = sum(r["joins"] for r in rows); total_l = sum(r["leaves"] for r in rows)
    footer(fig, f"total joins: {total_j:,} · total leaves: {total_l:,} · net: {total_j - total_l:+,}")
    save(fig, f"{OUT}/02_joins_vs_leaves.png")
    print(f"02 ok — joins {total_j} leaves {total_l}")


# ───────────────────────────────────────────── 3. Cohort retention heatmap
def chart_03_cohorts():
    cohorts = D["cohorts"]
    if not cohorts:
        return print("03 cohorts: no data")
    bucket_days = [b["days"] for b in cohorts[0]["buckets"]]
    grid = np.array([[b["pct"] for b in c["buckets"]] for c in cohorts])
    labels = [f"{c['weekStart']}\nn={c['size']}" for c in cohorts]
    fig, ax = dark_fig(figsize=(11, 7.5))
    cmap = LinearSegmentedColormap.from_list("ret", ["#0e0f12", "#3f3f46", "#8b95f0", "#22c55e"])
    im = ax.imshow(grid, aspect="auto", cmap=cmap, vmin=0, vmax=100)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, color=TEXT, fontsize=8)
    ax.set_xticks(range(len(bucket_days)))
    ax.set_xticklabels([f"≤{d}d" for d in bucket_days], color=TEXT)
    for i in range(grid.shape[0]):
        for j in range(grid.shape[1]):
            ax.text(j, i, f"{grid[i,j]:.0f}", ha="center", va="center",
                    color="white" if grid[i,j] > 50 else TEXT, fontsize=9, fontweight="bold")
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("% messaged", color=TEXT)
    cbar.ax.yaxis.set_tick_params(color=MUTED)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=MUTED)
    title(ax, "New-member retention by cohort week",
          "% of week's joiners who sent ≥1 message within N days of joining")
    footer(fig, f"{len(cohorts)} cohort weeks · most recent at bottom")
    save(fig, f"{OUT}/03_cohort_retention.png")
    print(f"03 ok — {len(cohorts)} cohorts")


# ───────────────────────────────────────────── 4. Time-to-first-message
def chart_04_time_to_first_msg():
    delays = D["timeToFirstMessage"]
    ghosts = D["ghostCount"]
    if not delays:
        return print("04 ttfm: no data")
    delays = np.array(delays)
    # Buckets in seconds: 60, 600, 3600, 21600, 86400, 7*86400, inf
    edges = [0, 60, 600, 3600, 21600, 86400, 7*86400, 30*86400, float("inf")]
    labels = ["≤1m", "1-10m", "10m-1h", "1-6h", "6-24h", "1-7d", "7-30d", ">30d"]
    counts = [int(np.sum((delays >= edges[i]) & (delays < edges[i+1]))) for i in range(len(labels))]
    counts.append(ghosts)
    labels.append("never\n(ghost)")
    colors = [SUCCESS]*3 + [ACCENT]*2 + [WARN]*2 + [DANGER]*1 + [FAINT]
    fig, ax = dark_fig(figsize=(12, 6.5))
    bars = ax.bar(labels, counts, color=colors)
    for b, c in zip(bars, counts):
        ax.text(b.get_x() + b.get_width()/2, b.get_height(), f"{c:,}",
                ha="center", va="bottom", color=TEXT, fontsize=9)
    title(ax, "Time from join to first message",
          "365-day window · 'never' = joined but no message yet")
    ax.set_ylabel("members", color=TEXT)
    total = sum(counts)
    messaged = total - ghosts
    footer(fig, f"messaged: {messaged:,} · ghosts: {ghosts:,} · total: {total:,} ({100*messaged/total:.1f}% reach first message)")
    save(fig, f"{OUT}/04_time_to_first_message.png")
    print(f"04 ok — {total} members, {ghosts} ghosts")


# ───────────────────────────────────────────── 5. Rapid join-leave funnel
def chart_05_rapid_join_leave():
    rows = D["rapidJoinLeave"]
    if not rows:
        return print("05 rapid: no data")
    dates = parse_dates(rows)
    cats = ["stayed", "leftLater", "left7d", "left24h"]
    colors = [SUCCESS, ACCENT, WARN, DANGER]
    fig, ax = dark_fig(figsize=(13, 6.5))
    bottom = np.zeros(len(dates))
    for cat, col in zip(cats, colors):
        vals = np.array([r[cat] for r in rows])
        ax.bar(dates, vals, bottom=bottom, color=col, width=1.0, label=cat, alpha=0.9)
        bottom += vals
    title(ax, "Daily join cohorts: who stuck around",
          "stacked by outcome · last 60 days")
    ax.set_ylabel("joins / day", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
    sums = {c: sum(r[c] for r in rows) for c in cats}
    total = sum(sums.values())
    pct24 = 100*sums["left24h"]/total if total else 0
    footer(fig, f"60d totals — stayed: {sums['stayed']:,} · left within 24h: {sums['left24h']:,} ({pct24:.1f}%)")
    save(fig, f"{OUT}/05_rapid_join_leave.png")
    print(f"05 ok — {total} joins in 60d")


# ───────────────────────────────────────────── 6. Messages YoY
def chart_06_messages_yoy():
    rows = D["messagesYoY"]
    if not rows:
        return print("06 msgYoY: no data")
    by_date = {r["date"]: r["count"] for r in rows}
    end = NOW.date()
    # build 365 days ending today, and 365 days ending today-365
    cur_dates, cur_vals = [], []
    prev_dates, prev_vals = [], []
    for i in range(365):
        d = end - dt.timedelta(days=364 - i)
        cur_dates.append(d)
        cur_vals.append(by_date.get(d.isoformat(), 0))
        prev = d - dt.timedelta(days=365)
        prev_dates.append(d)  # shift onto same x axis
        prev_vals.append(by_date.get(prev.isoformat(), 0))
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.plot(prev_dates, prev_vals, color=FAINT, linewidth=1.1, label=f"{end.year - 1}", alpha=0.7)
    ax.plot(cur_dates, cur_vals, color=SUCCESS, linewidth=1.8, label=f"{end.year}")
    cur_ma = rolling(cur_vals, 14)
    prev_ma = rolling(prev_vals, 14)
    ax.plot(cur_dates, cur_ma, color=ACCENT, linewidth=2.2, label="this year, 14d MA")
    title(ax, "Messages per day — year over year",
          "current 365d vs same dates one year ago, shifted onto same x-axis")
    ax.set_ylabel("messages / day", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b"))
    cur_30 = sum(cur_vals[-30:]); prev_30 = sum(prev_vals[-30:])
    delta = 100*(cur_30 - prev_30)/prev_30 if prev_30 else 0
    footer(fig, f"last 30d this year: {cur_30:,} · same 30d last year: {prev_30:,} · {delta:+.1f}% YoY")
    save(fig, f"{OUT}/06_messages_yoy.png")
    print(f"06 ok — cur30={cur_30} prev30={prev_30}")


# ───────────────────────────────────────────── 7. Hour × DoW heatmap
def chart_07_hour_dow():
    heat = np.array(D["hourDow"])
    if heat.sum() == 0:
        return print("07 heatmap: empty")
    dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hours = [f"{h:02d}" for h in range(24)]
    fig, ax = dark_fig(figsize=(13, 6))
    cmap = LinearSegmentedColormap.from_list("act", ["#0e0f12", "#27272a", "#3f3f46", "#8b95f0", "#22c55e", "#f7c948"])
    im = ax.imshow(heat, aspect="auto", cmap=cmap)
    ax.set_yticks(range(7))
    ax.set_yticklabels(dows, color=TEXT)
    ax.set_xticks(range(24))
    ax.set_xticklabels(hours, color=TEXT, fontsize=8)
    ax.set_xlabel("hour (UTC)", color=MUTED)
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("messages", color=TEXT)
    cbar.ax.yaxis.set_tick_params(color=MUTED)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=MUTED)
    title(ax, "When the server is alive",
          "messages by hour × day-of-week · last 90 days · UTC")
    peak_idx = np.unravel_index(np.argmax(heat), heat.shape)
    footer(fig, f"peak: {dows[peak_idx[0]]} @ {peak_idx[1]:02d}:00 UTC = {int(heat[peak_idx]):,} msgs · total {int(heat.sum()):,}")
    save(fig, f"{OUT}/07_hour_dow_heatmap.png")
    print(f"07 ok — total {int(heat.sum())} msgs, peak {dows[peak_idx[0]]} {peak_idx[1]}h")


# ───────────────────────────────────────────── 8. Channel ranking
def chart_08_channels():
    rows = D["channelRanking"]
    if not rows:
        return print("08 channels: no data")
    rows = rows[::-1]  # largest at top in barh
    names = [f"#{r['name'][:24]}" for r in rows]
    msgs = [r["messages"] for r in rows]
    users = [r["users"] for r in rows]
    fig, ax = dark_fig(figsize=(13, 7))
    bars = ax.barh(names, msgs, color=ACCENT, alpha=0.9)
    for b, m, u in zip(bars, msgs, users):
        ax.text(b.get_width(), b.get_y() + b.get_height()/2,
                f"  {m:,} · {u} users",
                va="center", color=TEXT, fontsize=8)
    title(ax, "Top channels by message volume",
          "last 30 days · top 15 · count · unique users")
    ax.set_xlabel("messages", color=MUTED)
    footer(fig, f"top channel {rows[-1]['name']} carried {msgs[-1]:,} msgs ({100*msgs[-1]/sum(msgs):.1f}% of top-15)")
    save(fig, f"{OUT}/08_channel_ranking.png")
    print(f"08 ok — {len(rows)} channels, top={rows[-1]['name']}")


# ───────────────────────────────────────────── 9. Lorenz curve
def chart_09_lorenz():
    counts = D["userMessageCounts"]
    if len(counts) < 5:
        return print(f"09 lorenz: only {len(counts)} users in user_message_counts — skipping")
    counts = sorted(counts)
    n = len(counts)
    total = sum(counts)
    cum = np.cumsum(counts) / total
    x = np.linspace(0, 1, n)
    fig, ax = dark_fig(figsize=(10, 8))
    ax.plot([0, 1], [0, 1], color=FAINT, linestyle="--", linewidth=1, label="perfect equality")
    ax.plot(x, cum, color=ACCENT, linewidth=2.5, label="actual")
    ax.fill_between(x, x, cum, color=ACCENT, alpha=0.18)
    # Gini = 1 - 2 * area under Lorenz
    gini = 1 - 2 * np.trapezoid(cum, x)
    title(ax, "Communicator inequality (Lorenz curve)",
          f"{n:,} users · Gini = {gini:.3f} (0 = equal, 1 = one person)")
    ax.set_xlabel("cumulative share of users (poorest → richest)", color=MUTED)
    ax.set_ylabel("cumulative share of messages", color=MUTED)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    # Stats
    top1 = sum(counts[-max(1, n//100):]) / total * 100
    top10 = sum(counts[-max(1, n//10):]) / total * 100
    footer(fig, f"top 1% sends {top1:.1f}% · top 10% sends {top10:.1f}% · total {total:,} msgs")
    save(fig, f"{OUT}/09_lorenz.png")
    print(f"09 ok — n={n} gini={gini:.3f}")


# ───────────────────────────────────────────── 10. Daily distinct communicators
def chart_10_distinct():
    rows = D["distinctCommunicators"]
    if not rows:
        return print("10 distinct: no data")
    dates = parse_dates(rows)
    users = [r["users"] for r in rows]
    ma7 = rolling(users, 7)
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.plot(dates, users, color=SECONDARY, linewidth=0.9, alpha=0.5, label="daily")
    ax.plot(dates, ma7, color=ACCENT, linewidth=2.2, label="7d MA")
    ax.fill_between(dates, ma7, color=ACCENT, alpha=0.1)
    title(ax, "Daily distinct communicators",
          "how many unique people sent at least one message that day · last 180d")
    ax.set_ylabel("users", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b '%y"))
    cur = users[-1]; avg = sum(users[-30:])/30
    footer(fig, f"yesterday: {cur} · 30d avg: {avg:.0f} · peak: {max(users)} on {dates[users.index(max(users))]}")
    save(fig, f"{OUT}/10_distinct_communicators.png")
    print(f"10 ok — peak {max(users)}")


# ───────────────────────────────────────────── 11. Voice minutes per day
def chart_11_voice_daily():
    rows = D["voiceMinutesDaily"]
    if not rows:
        return print("11 voice: no data")
    dates = parse_dates(rows)
    mins = [r["minutes"] for r in rows]
    ma7 = rolling(mins, 7)
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.fill_between(dates, mins, color=ACCENT, alpha=0.18)
    ax.plot(dates, mins, color=ACCENT, linewidth=1.2, alpha=0.6, label="daily")
    ax.plot(dates, ma7, color=SUCCESS, linewidth=2.4, label="7d MA")
    # weekend bands
    for d in dates:
        if d.weekday() >= 5:
            ax.axvspan(d, d + dt.timedelta(days=1), color=WARN, alpha=0.05)
    title(ax, "Voice minutes per day",
          "last 90 days · weekend bands shaded")
    ax.set_ylabel("minutes / day", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
    total = sum(mins); peak = max(mins)
    footer(fig, f"total: {total:,} min ({total/60:.0f}h) · peak day: {peak:,} min on {dates[mins.index(peak)]}")
    save(fig, f"{OUT}/11_voice_minutes.png")
    print(f"11 ok — total {total} min")


# ───────────────────────────────────────────── 12. Voice channel treemap
def chart_12_voice_treemap():
    rows = D["voiceChannelTotals"]
    if not rows:
        return print("12 treemap: no data")
    import squarify
    sizes = [r["minutes"] for r in rows]
    labels = [f"#{r['name'][:18]}\n{r['minutes']:,} min\n{r['users']} users" for r in rows]
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(rows))]
    fig, ax = dark_fig(figsize=(12, 7.5))
    ax.set_facecolor(BG)
    squarify.plot(sizes=sizes, label=labels, color=colors, ax=ax,
                  text_kwargs={"color": "white", "fontsize": 9, "fontweight": "bold"},
                  alpha=0.88, pad=True)
    ax.axis("off")
    title(ax, "Voice channel usage (last 30d)",
          "rectangle area = total minutes")
    total = sum(sizes)
    footer(fig, f"total voice: {total:,} min across top {len(rows)} channels")
    save(fig, f"{OUT}/12_voice_treemap.png")
    print(f"12 ok — {len(rows)} channels")


# ───────────────────────────────────────────── 13. Voice session length
def chart_13_voice_session_dur():
    durs = D["voiceSessionDurations"]
    if not durs:
        return print("13 dur: no data")
    arr = np.array(durs)
    arr = arr[arr > 0]
    # log-scale buckets: 1s..1d
    bins = np.logspace(0, np.log10(arr.max()), 50)
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.hist(arr, bins=bins, color=ACCENT, edgecolor=BG, alpha=0.9)
    ax.set_xscale("log")
    median = np.median(arr); p95 = np.percentile(arr, 95)
    ax.axvline(median, color=SUCCESS, linewidth=1.5, linestyle="--", label=f"median {median/60:.1f}m")
    ax.axvline(p95, color=WARN, linewidth=1.5, linestyle="--", label=f"p95 {p95/3600:.1f}h")
    # ticks
    ax.set_xticks([10, 60, 600, 3600, 14400, 86400])
    ax.set_xticklabels(["10s", "1m", "10m", "1h", "4h", "1d"])
    title(ax, "Voice session length distribution",
          "last 60 days · closed sessions only · log scale")
    ax.set_xlabel("session duration", color=MUTED)
    ax.set_ylabel("sessions", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper right", fontsize=9)
    footer(fig, f"{len(arr):,} sessions · median {median/60:.1f}m · p95 {p95/3600:.2f}h · max {arr.max()/3600:.1f}h")
    save(fig, f"{OUT}/13_voice_session_durations.png")
    print(f"13 ok — n={len(arr)} median={median/60:.1f}m")


# ───────────────────────────────────────────── 14. Decisions stacked
def chart_14_decisions():
    rows = D["decisionsStacked"]
    if not rows:
        return print("14 decisions: no data")
    dates = parse_dates(rows)
    cats = ["approve", "reject", "perm_reject", "kick"]
    colors = [SUCCESS, WARN, DANGER, "#9333ea"]
    fig, ax = dark_fig(figsize=(13, 6.5))
    bottom = np.zeros(len(dates))
    for cat, col in zip(cats, colors):
        v = np.array([r.get(cat, 0) for r in rows])
        ax.fill_between(dates, bottom, bottom + v, color=col, alpha=0.85, label=cat, linewidth=0)
        bottom += v
    title(ax, "Daily review decisions",
          "stacked by action · last 90 days")
    ax.set_ylabel("decisions / day", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
    totals = {c: sum(r.get(c, 0) for r in rows) for c in cats}
    grand = sum(totals.values())
    breakdown = " · ".join(f"{c}: {totals[c]:,} ({100*totals[c]/grand:.0f}%)" for c in cats)
    footer(fig, f"{breakdown} · total {grand:,}")
    save(fig, f"{OUT}/14_decisions_stacked.png")
    print(f"14 ok — {grand} decisions")


# ───────────────────────────────────────────── 15. Application funnel
def chart_15_app_funnel():
    rows = D["applicationFunnel"]
    if not rows:
        return print("15 funnel: no data")
    rows = sorted(rows, key=lambda r: -r["c"])
    statuses = [r["status"] for r in rows]
    counts = [r["c"] for r in rows]
    color_map = {"approved": SUCCESS, "rejected": WARN, "perm_rejected": DANGER, "kicked": "#9333ea",
                 "submitted": ACCENT, "needs_info": "#38bdf8", "withdrawn": FAINT}
    colors = [color_map.get(s, FAINT) for s in statuses]
    fig, ax = dark_fig(figsize=(12, 6.5))
    bars = ax.bar(statuses, counts, color=colors, alpha=0.9)
    for b, c in zip(bars, counts):
        ax.text(b.get_x() + b.get_width()/2, b.get_height(), f"{c:,}",
                ha="center", va="bottom", color=TEXT, fontsize=10, fontweight="bold")
    total = sum(counts)
    title(ax, "Application funnel — all time",
          f"{total:,} applications by terminal status")
    ax.set_ylabel("applications", color=TEXT)
    footer(fig, " · ".join(f"{s}: {c:,} ({100*c/total:.1f}%)" for s, c in zip(statuses, counts)))
    save(fig, f"{OUT}/15_application_funnel.png")
    print(f"15 ok — total {total}")


# ───────────────────────────────────────────── 16. Mod workload
def chart_16_mod_workload():
    rows = D["modWorkload"]
    if not rows:
        return print("16 mods: no data")
    # reverse so largest is at top in barh
    rows_r = rows[::-1]
    names = [r["name"][:22] for r in rows_r]
    approves = np.array([r.get("approve", 0) for r in rows_r])
    rejects = np.array([r.get("reject", 0) for r in rows_r])
    perm = np.array([r.get("permReject", 0) for r in rows_r])
    kicks = np.array([r.get("kick", 0) for r in rows_r])
    totals = approves + rejects + perm + kicks
    n = len(names)
    fig, ax = dark_fig(figsize=(13, max(7, 0.35 * n + 2)))
    y = np.arange(n)
    ax.barh(y, approves, color=SUCCESS, label="approve", alpha=0.9)
    ax.barh(y, rejects, left=approves, color=WARN, label="reject", alpha=0.9)
    ax.barh(y, perm, left=approves + rejects, color="#9333ea", label="perm_reject", alpha=0.9)
    ax.barh(y, kicks, left=approves + rejects + perm, color=DANGER, label="kick", alpha=0.9)
    ax.set_yticks(y)
    ax.set_yticklabels(names, color=TEXT, fontsize=9)
    for yi, t in zip(y, totals):
        label = f"  {t:,}" if t > 0 else "  0 (never used)"
        ax.text(t, yi, label, va="center", color=TEXT if t > 0 else FAINT, fontsize=8)
    title(ax, "Moderator workload — every mod ever",
          f"all time · action_log + mod_metrics union · {n} mods")
    ax.set_xlabel("reviews", color=MUTED)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="lower right", fontsize=9)
    if totals.max() > 0:
        ax.set_xlim(left=-totals.max() * 0.02)
    # Gini over all mods incl zeros
    sorted_totals = sorted(totals.tolist())
    if n > 1 and sum(sorted_totals) > 0:
        cum = np.cumsum(sorted_totals) / sum(sorted_totals)
        gini = 1 - 2 * np.trapezoid(cum, np.linspace(0, 1, n))
    else:
        gini = 0
    top1 = totals.max(); grand = totals.sum()
    zero_count = int((totals == 0).sum())
    footer(fig,
           f"top mod: {100*top1/grand:.1f}% · {zero_count} mods with 0 reviews · workload Gini: {gini:.2f} · total: {grand:,}")
    save(fig, f"{OUT}/16_mod_workload.png")
    print(f"16 ok — {n} mods ({zero_count} never reviewed)")


# ───────────────────────────────────────────── 17. Modmail response time
def chart_17_modmail_response():
    rows = D["modmailResponse"]
    if not rows:
        return print("17 modmail: no data")
    dates = parse_dates(rows)
    p50 = [r["p50"]/60 if r["p50"] else 0 for r in rows]
    p95 = [r["p95"]/60 if r["p95"] else 0 for r in rows]
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.fill_between(dates, p50, p95, color=ACCENT, alpha=0.18, label="p50–p95 range")
    ax.plot(dates, p50, color=SUCCESS, linewidth=2, label="p50 (median)")
    ax.plot(dates, p95, color=WARN, linewidth=2, label="p95")
    title(ax, "Modmail first-reply time",
          "minutes from ticket open to first staff reply · last 90d (daily)")
    ax.set_ylabel("minutes", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
    # cap y so single outlier doesn't kill scale
    if p95:
        cap = sorted(p95)[int(len(p95)*0.9)] * 1.5
        ax.set_ylim(0, cap if cap > 10 else None)
    last7 = [r["p50"] for r in rows[-7:] if r["p50"]]
    med7 = (sum(last7)/len(last7)/60) if last7 else 0
    total_tickets = sum(r["count"] for r in rows)
    footer(fig, f"{total_tickets:,} tickets · last 7d median first-reply: {med7:.1f} min")
    save(fig, f"{OUT}/17_modmail_response.png")
    print(f"17 ok — {total_tickets} tickets")


# ───────────────────────────────────────────── 18. Flag timeline
def chart_18_flags():
    rows = D["flagsTimeline"]
    if not rows:
        return print("18 flags: no data")
    dates = parse_dates(rows)
    nsfw = [r["nsfw"] for r in rows]
    behav = [r["behavioral"] for r in rows]
    fig, ax = dark_fig(figsize=(13, 6.5))
    ax.bar(dates, nsfw, color=DANGER, width=1.0, label="NSFW avatar flags", alpha=0.9)
    ax.bar(dates, behav, bottom=nsfw, color=WARN, width=1.0, label="behavioral flags", alpha=0.9)
    combined = [n+b for n,b in zip(nsfw, behav)]
    ma7 = rolling(combined, 7)
    ax.plot(dates, ma7, color=ACCENT, linewidth=2, label="7d MA (combined)")
    title(ax, "Flags raised per day",
          "NSFW avatar + behavioral · last 120 days")
    ax.set_ylabel("flags / day", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)
    ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
    total_n = sum(nsfw); total_b = sum(behav)
    footer(fig, f"NSFW: {total_n:,} · behavioral: {total_b:,} · combined: {total_n+total_b:,}")
    save(fig, f"{OUT}/18_flag_timeline.png")
    print(f"18 ok — {total_n+total_b} total flags")


# ───────────────────────────────────────────── 19. Growth source breakdown
def chart_19_growth_source():
    g = D["growthSource"]
    weeks = g["weeks"]
    codes = g["codes"]
    if not weeks:
        return print("19 source: no data")
    dates = [dt.date.fromisoformat(w["week"]) for w in weeks]
    cats = list(codes) + ["other"]
    colors = PALETTE[:len(codes)] + [FAINT]
    fig, ax = dark_fig(figsize=(13, 7))
    bottom = np.zeros(len(dates))
    for cat, col in zip(cats, colors):
        v = np.array([w.get(cat, 0) for w in weeks])
        if v.sum() == 0:
            continue
        ax.fill_between(dates, bottom, bottom + v, color=col, alpha=0.85, label=cat, linewidth=0)
        bottom += v
    title(ax, "Where joins came from (by invite code)",
          "weekly · last ~180 days · 'other' = unknown/null invite")
    ax.set_ylabel("joins / week", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=8, ncol=2)
    ax.xaxis.set_major_formatter(DateFormatter("%b '%y"))
    # Top code share latest week
    if weeks:
        last = weeks[-1]
        total_last = sum(v for k, v in last.items() if k != "week")
        if total_last > 0 and codes:
            top = max(codes, key=lambda c: last.get(c, 0))
            footer(fig, f"last week: top code '{top}' = {last.get(top, 0)} joins ({100*last.get(top,0)/total_last:.0f}% of {total_last})")
    save(fig, f"{OUT}/19_growth_source.png")
    print(f"19 ok — {len(codes)} top codes")


# ───────────────────────────────────────────── 20. Inviter scatter
def chart_20_inviter_retention():
    rows = D["inviterRetention"]
    if len(rows) < 2:
        return print(f"20 inviters: only {len(rows)} qualifying inviters — skipping")
    invited = [r["invited"] for r in rows]
    messaged = [r["messaged"] for r in rows]
    pct = [100*m/i if i else 0 for m, i in zip(messaged, invited)]
    names = [r["name"][:18] for r in rows]
    fig, ax = dark_fig(figsize=(13, 7))
    sizes = [max(40, i * 6) for i in invited]
    sc = ax.scatter(invited, pct, s=sizes, c=pct, cmap=LinearSegmentedColormap.from_list("ret", [DANGER, WARN, ACCENT, SUCCESS]),
                    alpha=0.85, edgecolor=BG, linewidth=1)
    for x, y, n in zip(invited, pct, names):
        ax.annotate(n, (x, y), color=TEXT, fontsize=8, xytext=(6, 4), textcoords="offset points")
    ax.axhline(np.mean(pct), color=FAINT, linestyle="--", linewidth=1, alpha=0.6,
               label=f"avg retention {np.mean(pct):.1f}%")
    cbar = fig.colorbar(sc, ax=ax)
    cbar.set_label("retention %", color=TEXT)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=MUTED)
    title(ax, "Inviter quality — volume vs retention",
          "x = members invited (last 180d) · y = % of them who sent a message · bubble size = invited count")
    ax.set_xlabel("members invited", color=MUTED)
    ax.set_ylabel("% who messaged", color=TEXT)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, loc="lower right", fontsize=9)
    footer(fig, f"{len(rows)} inviters with ≥3 invites · top volume: {names[0]} ({invited[0]} invited, {pct[0]:.0f}% retention)")
    save(fig, f"{OUT}/20_inviter_retention.png")
    print(f"20 ok — n={len(rows)}")


# ───────────────────────────────────────────────────────────── run all
CHARTS = [
    chart_01_members, chart_02_joins_leaves, chart_03_cohorts, chart_04_time_to_first_msg,
    chart_05_rapid_join_leave, chart_06_messages_yoy, chart_07_hour_dow, chart_08_channels,
    chart_09_lorenz, chart_10_distinct, chart_11_voice_daily, chart_12_voice_treemap,
    chart_13_voice_session_dur, chart_14_decisions, chart_15_app_funnel, chart_16_mod_workload,
    chart_17_modmail_response, chart_18_flags, chart_19_growth_source, chart_20_inviter_retention,
]
errors = []
for fn in CHARTS:
    try:
        fn()
    except Exception as e:
        print(f"!! {fn.__name__} failed: {e}")
        import traceback; traceback.print_exc()
        errors.append((fn.__name__, str(e)))
print(f"\n{'='*60}\n{len(CHARTS) - len(errors)} / {len(CHARTS)} charts rendered into {OUT}/")
if errors:
    print("failures:")
    for n, e in errors:
        print(f"  - {n}: {e}")
