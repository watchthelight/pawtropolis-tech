"""Generic styled-sheet writer.

Every sheet in the workbook goes through write_table, so header styling, number
formats, widths, freeze panes, autofilter, banding and conditional formatting stay
consistent by construction rather than by discipline.
"""

import re
from datetime import datetime, timezone

import theme
from formats import Formats
from introspect import Column
from kinds import BOOL, ENUM, INT, ISO_DT, JSON, REAL, SNOWFLAKE, TEXT, UNIX_TS

EXCEL_CELL_LIMIT = 32767
EXCEL_ROW_LIMIT = 1_048_576
TRUNCATION_MARK = " ...[truncated]"

_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_INVALID_SHEET_RE = re.compile(r"[\[\]:*?/\\]")

_TS_MIN = 1_000_000_000
_TS_MAX = 4_000_000_000

_ISO_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
)


def col(name, kind, width=None):
    """Lightweight column spec for hand-written panels."""
    spec = Column(name=name, decl_type="", notnull=False, pk=False, kind=kind)
    spec.width = width or max(10, min(40, len(name) + 4))
    return spec


def clean_text(value):
    text = _CTRL_RE.sub("", str(value))
    if len(text) > EXCEL_CELL_LIMIT:
        text = text[: EXCEL_CELL_LIMIT - len(TRUNCATION_MARK)] + TRUNCATION_MARK
    return text


def _parse_iso(value):
    raw = str(value).strip()
    for fmt in _ISO_FORMATS:
        try:
            return datetime.strptime(raw[:19], fmt)
        except ValueError:
            continue
    return None


def _w_text(ws, r, c, v, fmt):
    ws.write_string(r, c, clean_text(v), fmt)


def _w_number(ws, r, c, v, fmt):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        ws.write_number(r, c, v, fmt)
    else:
        ws.write_string(r, c, clean_text(v), fmt)


def _w_unix(ws, r, c, v, fmt):
    if isinstance(v, (int, float)) and _TS_MIN <= v <= _TS_MAX:
        stamp = datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
        ws.write_datetime(r, c, stamp, fmt)
    else:
        ws.write_string(r, c, clean_text(v), fmt)


def _w_iso(ws, r, c, v, fmt):
    parsed = _parse_iso(v) if isinstance(v, str) else None
    if parsed is not None:
        ws.write_datetime(r, c, parsed, fmt)
    else:
        ws.write_string(r, c, clean_text(v), fmt)


WRITERS = {
    TEXT: _w_text, ENUM: _w_text, JSON: _w_text, SNOWFLAKE: _w_text,
    INT: _w_number, REAL: _w_number, BOOL: _w_number,
    UNIX_TS: _w_unix, ISO_DT: _w_iso,
}


class Report:
    """Workbook-level state: format cache, sheet naming, table of contents."""

    def __init__(self, wb, conn, args):
        self.wb = wb
        self.conn = conn
        self.args = args
        self.fmts = Formats(wb)
        self.entries = []
        self._used_names = set()
        self.warnings = []

    def sheet_name(self, desired):
        name = _INVALID_SHEET_RE.sub("_", str(desired)).strip("'")[:31] or "sheet"
        if name not in self._used_names:
            self._used_names.add(name)
            return name
        stem = name[:27]
        for n in range(2, 999):
            candidate = stem + "_" + str(n)
            if candidate not in self._used_names:
                self._used_names.add(candidate)
                return candidate
        raise RuntimeError("cannot allocate a sheet name for " + repr(desired))

    def record(self, sheet, category, description, written, expected=None, note=""):
        self.entries.append({
            "sheet": sheet,
            "category": category,
            "description": description,
            "written": written,
            "expected": expected if expected is not None else written,
            "note": note,
        })

    def warn(self, message):
        self.warnings.append(message)


def write_table(report, sheet_name, columns, rows, *, category="raw",
                description="", expected=None, note="", freeze_col=0,
                autofilter=True, banded=True, value_formats=True,
                worksheet=None, start_row=0):
    """Write a fully styled sheet and register it for the table of contents."""
    ws = worksheet or report.wb.add_worksheet(report.sheet_name(sheet_name))
    if worksheet is None:
        tab = theme.CATEGORY_COLOR.get(category, theme.CATEGORY_COLOR["raw"])
        ws.set_tab_color(tab)

    fmts = report.fmts
    header_fmt = fmts.header()
    ncols = len(columns)

    for idx, column in enumerate(columns):
        ws.set_column(idx, idx, column.width)
        ws.write_string(start_row, idx, column.name, header_fmt)
    ws.set_row(start_row, 30)

    col_writers = [WRITERS.get(c.kind, _w_text) for c in columns]
    col_formats = [fmts.cell(c.kind) for c in columns]

    written = 0
    max_data_rows = EXCEL_ROW_LIMIT - start_row - 2
    for offset, row in enumerate(rows):
        if written >= max_data_rows:
            report.warn(sheet_name + ": hit the Excel row ceiling, output truncated")
            break
        excel_row = start_row + 1 + offset
        for cidx in range(ncols):
            value = row[cidx] if cidx < len(row) else None
            if value is None:
                continue
            col_writers[cidx](ws, excel_row, cidx, value, col_formats[cidx])
        written += 1

    last_row = start_row + written
    ws.freeze_panes(start_row + 1, freeze_col)
    if autofilter and ncols and written:
        ws.autofilter(start_row, 0, last_row, ncols - 1)

    if written and value_formats:
        _apply_value_formats(ws, columns, start_row, last_row, report)
    if written and banded:
        ws.conditional_format(start_row + 1, 0, last_row, ncols - 1, {
            "type": "formula",
            "criteria": "=MOD(ROW(),2)=0",
            "format": fmts.get(bg_color=theme.BAND_BG),
        })

    if description or note:
        comment = (description + "\n" + note).strip()
        ws.write_comment(start_row, 0, comment, {"width": 260, "height": 110})

    if worksheet is None:
        report.record(ws.get_name(), category, description, written, expected, note)
    return ws


def _apply_value_formats(ws, columns, start_row, last_row, report):
    """Conditional formatting chosen by inferred column kind.

    Enum and boolean rules are registered before the banding stripe so a meaning
    colour outranks it: xlsxwriter gives earlier rules the higher priority.
    """
    fmts = report.fmts
    first = start_row + 1
    for idx, column in enumerate(columns):
        kind = column.kind
        if kind in (INT, REAL):
            ws.conditional_format(first, idx, last_row, idx, {
                "type": "data_bar",
                "bar_color": theme.BAR_POS,
                "bar_solid": False,
            })
        elif kind in (UNIX_TS, ISO_DT):
            ws.conditional_format(first, idx, last_row, idx, {
                "type": "2_color_scale",
                "min_color": theme.DATE_LOW,
                "max_color": theme.DATE_HIGH,
            })
        elif kind == BOOL:
            on_fill, on_font = theme.TINT["green"]
            off_fill, off_font = theme.TINT["grey"]
            ws.conditional_format(first, idx, last_row, idx, {
                "type": "cell", "criteria": "==", "value": 1,
                "format": fmts.get(bg_color=on_fill, font_color=on_font),
            })
            ws.conditional_format(first, idx, last_row, idx, {
                "type": "cell", "criteria": "==", "value": 0,
                "format": fmts.get(bg_color=off_fill, font_color=off_font),
            })
        elif kind == ENUM and column.distinct:
            for n, value in enumerate(column.distinct):
                fill, font = theme.tint_for(column.name, value, n)
                ws.conditional_format(first, idx, last_row, idx, {
                    "type": "cell", "criteria": "==",
                    "value": '"' + str(value) + '"',
                    "format": fmts.get(bg_color=fill, font_color=font),
                })
