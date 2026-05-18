import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BG = "#0e0f12"
PANEL = "#16181d"
GRID = "#27272a"
TEXT = "#e4e4e7"
MUTED = "#a1a1aa"
FAINT = "#71717a"
ACCENT = "#8b95f0"
SUCCESS = "#22c55e"
WARN = "#f7c948"
DANGER = "#d4423a"
SECONDARY = "#3f3f46"

# Categorical palette for stacks/legends
PALETTE = ["#8b95f0", "#22c55e", "#f7c948", "#d4423a", "#9f7aea", "#38bdf8",
           "#f97316", "#14b8a6", "#ec4899", "#a3a3a3"]


def style_axes(ax):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=MUTED, labelsize=9)
    for s in ax.spines.values():
        s.set_color(GRID)
    ax.grid(True, color=GRID, linewidth=0.5, alpha=0.7)


def dark_fig(figsize=(12, 6.5), nrows=1, ncols=1, **kwargs):
    fig, axes = plt.subplots(nrows=nrows, ncols=ncols, figsize=figsize, **kwargs)
    fig.patch.set_facecolor(BG)
    if hasattr(axes, "flat"):
        for a in axes.flat:
            style_axes(a)
    else:
        style_axes(axes)
    return fig, axes


def title(ax, text, subtitle=None):
    ax.set_title(text, color=TEXT, fontsize=12, loc="left",
                 pad=28 if subtitle else 8, fontweight="bold")
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes,
                color=MUTED, fontsize=9, va="bottom")


def footer(fig, text):
    fig.text(0.5, 0.015, text, color=MUTED, fontsize=9, ha="center")


def save(fig, path, dpi=140):
    fig.savefig(path, dpi=dpi, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)


def rolling(xs, n):
    out = []
    for i in range(len(xs)):
        s = max(0, i - n + 1)
        win = xs[s:i + 1]
        out.append(sum(win) / len(win) if win else 0)
    return out
