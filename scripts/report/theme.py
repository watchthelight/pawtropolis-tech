"""Excel palette for the Pawtropolis report workbook.

Hues are lifted from scripts/charts/theme.py so the workbook reads as part of the
same family as the PNG charts in _charts_out/. That theme targets a dark canvas;
Excel renders on white, so the surface colours here are tinted equivalents of the
same hues rather than new inventions.
"""

ACCENT = "#8B95F0"
SUCCESS = "#22C55E"
WARN = "#F7C948"
DANGER = "#D4423A"
INFO = "#38BDF8"
VIOLET = "#9F7AEA"
ORANGE = "#F97316"
TEAL = "#14B8A6"
PINK = "#EC4899"
GREY = "#A3A3A3"

PALETTE = [ACCENT, SUCCESS, WARN, DANGER, VIOLET, INFO, ORANGE, TEAL, PINK, GREY]

HEADER_BG = "#2E3358"
HEADER_FG = "#FFFFFF"
SUBHEAD_BG = "#4A5085"
BAND_BG = "#F5F6FB"
BORDER = "#D4D7E3"
TEXT = "#1F2130"
MUTED = "#6B6F84"
CARD_BG = "#EEF0F9"

TINT = {
    "green": ("#DCFCE7", "#14532D"),
    "red": ("#FEE2E2", "#7F1D1D"),
    "amber": ("#FEF3C7", "#78350F"),
    "blue": ("#DBEAFE", "#1E3A5F"),
    "violet": ("#EDE9FE", "#4C1D95"),
    "grey": ("#E9EAEF", "#3F3F46"),
    "teal": ("#CCFBF1", "#134E4A"),
    "pink": ("#FCE7F3", "#831843"),
}

TINT_CYCLE = ["blue", "green", "amber", "violet", "teal", "pink", "red", "grey"]

CATEGORY_COLOR = {
    "nav": "#2E3358",
    "overview": ACCENT,
    "members": INFO,
    "messages": SUCCESS,
    "moderation": WARN,
    "applications": VIOLET,
    "modmail": TEAL,
    "voice": ORANGE,
    "economy": PINK,
    "security": DANGER,
    "reference": GREY,
    "raw": "#9AA0B5",
}

CATEGORY_ORDER = [
    "nav", "overview", "members", "messages", "moderation", "applications",
    "modmail", "voice", "economy", "security", "reference", "raw",
]

SCALE_LOW = "#FFFFFF"
SCALE_MID = "#A9B4F5"
SCALE_HIGH = "#3B4272"

HEAT_LOW = "#FBFCFF"
HEAT_MID = "#8B95F0"
HEAT_HIGH = "#2E1065"

DATE_LOW = "#FFFFFF"
DATE_HIGH = "#7C86D9"

BAR_POS = "#8B95F0"
BAR_NEG = "#D4423A"

# Discrete meaning maps. Values not listed fall through to the rotating tint
# cycle, so an unmapped enum still gets a stable colour.
ENUM_TINTS = {
    "status": {
        "approved": "green", "rejected": "red", "needs_info": "amber",
        "draft": "grey", "submitted": "blue", "kicked": "red",
        "open": "blue", "closed": "grey", "pending": "amber",
        "done": "green", "failed": "red", "active": "green",
    },
    "action": {
        "approve": "green", "reject": "red", "claim": "blue", "unclaim": "grey",
        "member_join": "green", "member_leave": "red", "gate_submit": "blue",
        "app_submitted": "blue", "modmail_open": "teal", "modmail_close": "grey",
        "role_grant": "violet", "role_grant_skipped": "grey",
        "flag_dismissed": "amber", "listopen_view": "grey",
        "movie_tier_granted": "violet", "kick": "red", "ban": "red",
    },
}


def tint_for(column_name, value, index):
    """Fill/font pair for one enum value, preferring a known meaning map."""
    lname = (column_name or "").lower()
    for key, mapping in ENUM_TINTS.items():
        if key in lname:
            hit = mapping.get(str(value).lower())
            if hit:
                return TINT[hit]
    return TINT[TINT_CYCLE[index % len(TINT_CYCLE)]]
