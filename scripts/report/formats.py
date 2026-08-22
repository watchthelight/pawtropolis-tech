"""Cached xlsxwriter Format objects.

Formats must be reused. xlsxwriter serialises every distinct Format into the
workbook, so allocating one per cell both slows generation and inflates the file.
"""

import theme
from kinds import (
    BOOL, ENUM, INT, ISO_DT, JSON, REAL, SNOWFLAKE, TEXT, UNIX_TS,
)

NUM_FORMAT = {
    INT: "#,##0",
    REAL: "#,##0.00",
    UNIX_TS: "yyyy-mm-dd hh:mm",
    ISO_DT: "yyyy-mm-dd hh:mm",
    SNOWFLAKE: "@",
    BOOL: "#,##0",
    ENUM: "General",
    JSON: "@",
    TEXT: "General",
}


class Formats:
    def __init__(self, wb):
        self.wb = wb
        self._cache = {}

    def get(self, **props):
        key = tuple(sorted(props.items()))
        fmt = self._cache.get(key)
        if fmt is None:
            fmt = self.wb.add_format(props)
            self._cache[key] = fmt
        return fmt

    def header(self):
        return self.get(
            bold=True, font_color=theme.HEADER_FG, bg_color=theme.HEADER_BG,
            border=1, border_color=theme.HEADER_BG, align="left", valign="vcenter",
            text_wrap=True, font_size=10,
        )

    def cell(self, kind):
        props = {
            "font_size": 10, "valign": "top",
            "border": 1, "border_color": theme.BORDER,
            "num_format": NUM_FORMAT.get(kind, "General"),
        }
        if kind in (TEXT, JSON):
            props["text_wrap"] = False
        return self.get(**props)

    def title(self):
        return self.get(bold=True, font_size=16, font_color=theme.HEADER_BG)

    def subtitle(self):
        return self.get(font_size=10, font_color=theme.MUTED, italic=True)

    def section(self):
        return self.get(
            bold=True, font_size=11, font_color=theme.HEADER_FG,
            bg_color=theme.SUBHEAD_BG, align="left", valign="vcenter",
        )

    def kpi_label(self):
        return self.get(
            font_size=9, font_color=theme.MUTED, bg_color=theme.CARD_BG,
            align="center", valign="vcenter", top=1, left=1, right=1,
            border_color=theme.BORDER,
        )

    def kpi_value(self, color=None):
        return self.get(
            bold=True, font_size=20, font_color=color or theme.HEADER_BG,
            bg_color=theme.CARD_BG, align="center", valign="vcenter",
            num_format="#,##0", bottom=1, left=1, right=1,
            border_color=theme.BORDER,
        )

    def link(self):
        return self.get(
            font_color="#2E5AAC", underline=1, font_size=10,
            border=1, border_color=theme.BORDER,
        )

    def chip(self, hex_color):
        return self.get(bg_color=hex_color, border=1, border_color=theme.BORDER)

    def note(self):
        return self.get(font_size=9, font_color=theme.MUTED, italic=True)

    def warn_cell(self):
        fill, font = theme.TINT["amber"]
        return self.get(
            bg_color=fill, font_color=font, font_size=10, bold=True,
            border=1, border_color=theme.BORDER,
        )
