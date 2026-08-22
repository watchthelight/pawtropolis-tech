"""Shared helpers for analytics panels.

Panels describe what they want (SQL, column kinds, an optional chart) and this
module handles the xlsxwriter mechanics.
"""

import theme
import writer
from kinds import ENUM, INT, ISO_DT, REAL, SNOWFLAKE, TEXT, UNIX_TS

col = writer.col


def q(report, sql, params=()):
    return report.conn.execute(sql, params).fetchall()


def one(report, sql, params=(), default=0):
    row = report.conn.execute(sql, params).fetchone()
    if not row or row[0] is None:
        return default
    return row[0]


def sheet(report, name, columns, rows, *, category, description,
          chart=None, expected=None, note="", freeze_col=0, banded=True,
          value_formats=True):
    ws = writer.write_table(
        report, name, columns, rows, category=category, description=description,
        expected=expected, note=note, freeze_col=freeze_col, banded=banded,
        value_formats=value_formats,
    )
    if chart and rows:
        add_chart(report, ws, ws.get_name(), chart, len(rows), len(columns))
    return ws


def add_chart(report, ws, sheet_name, spec, nrows, ncols, anchor=None):
    """Insert a chart to the right of the data block."""
    opts = {"type": spec["type"]}
    if spec.get("subtype"):
        opts["subtype"] = spec["subtype"]
    chart = report.wb.add_chart(opts)

    cat_col = spec.get("cat_col", 0)
    for index, series in enumerate(spec["series"]):
        color = series.get("color") or theme.PALETTE[index % len(theme.PALETTE)]
        payload = {
            "name": series["name"],
            "categories": [sheet_name, 1, cat_col, nrows, cat_col],
            "values": [sheet_name, 1, series["col"], nrows, series["col"]],
        }
        if spec["type"] in ("line", "scatter"):
            payload["line"] = {"color": color, "width": 2.0}
            payload["marker"] = {"type": "none"}
        elif spec["type"] == "pie" or spec["type"] == "doughnut":
            payload["points"] = [
                {"fill": {"color": c}} for c in theme.PALETTE[:nrows]
            ]
        else:
            payload["fill"] = {"color": color}
            payload["border"] = {"none": True}
        chart.add_series(payload)

    chart.set_title({
        "name": spec["title"],
        "name_font": {"size": 12, "bold": True, "color": theme.HEADER_BG},
    })
    if spec["type"] not in ("pie", "doughnut"):
        chart.set_x_axis({
            "num_font": {"size": 8, "color": theme.MUTED},
            "line": {"color": theme.BORDER},
            "major_gridlines": {"visible": False},
        })
        chart.set_y_axis({
            "num_font": {"size": 8, "color": theme.MUTED},
            "major_gridlines": {"visible": True, "line": {"color": theme.BORDER}},
            "line": {"none": True},
        })
    if len(spec["series"]) == 1 and spec["type"] not in ("pie", "doughnut"):
        chart.set_legend({"none": True})
    else:
        chart.set_legend({"position": "bottom", "font": {"size": 8}})
    chart.set_chartarea({"border": {"color": theme.BORDER}, "fill": {"color": "#FFFFFF"}})
    chart.set_plotarea({"fill": {"color": "#FFFFFF"}})
    chart.set_size({"width": spec.get("width", 640), "height": spec.get("height", 340)})

    row, column = anchor if anchor else (1, ncols + 1)
    ws.insert_chart(row, column, chart)
    return chart


def matrix_sheet(report, name, row_labels, col_labels, grid, *, category,
                 description, corner="", low=None, mid=None, high=None,
                 note="", number_format="#,##0"):
    """A label x label grid rendered as a colour-scaled heatmap."""
    ws = report.wb.add_worksheet(report.sheet_name(name))
    ws.set_tab_color(theme.CATEGORY_COLOR.get(category, theme.CATEGORY_COLOR["raw"]))
    fmts = report.fmts

    header = fmts.header()
    ws.set_row(0, 28)
    ws.set_column(0, 0, max(12, min(30, max((len(str(r)) for r in row_labels), default=10) + 3)))
    ws.set_column(1, len(col_labels), 9)
    ws.write_string(0, 0, corner, header)
    for c, label in enumerate(col_labels):
        ws.write_string(0, c + 1, str(label), header)

    body = fmts.get(
        font_size=10, align="center", border=1, border_color=theme.BORDER,
        num_format=number_format,
    )
    label_fmt = fmts.get(
        font_size=10, bold=True, border=1, border_color=theme.BORDER,
        bg_color=theme.CARD_BG,
    )
    for r, label in enumerate(row_labels):
        ws.write_string(r + 1, 0, str(label), label_fmt)
        for c in range(len(col_labels)):
            value = grid[r][c] if c < len(grid[r]) else None
            if value is None:
                ws.write_blank(r + 1, c + 1, None, body)
            else:
                ws.write_number(r + 1, c + 1, value, body)

    if row_labels and col_labels:
        ws.conditional_format(1, 1, len(row_labels), len(col_labels), {
            "type": "3_color_scale",
            "min_color": low or theme.HEAT_LOW,
            "mid_color": mid or theme.HEAT_MID,
            "max_color": high or theme.HEAT_HIGH,
        })
    ws.freeze_panes(1, 1)
    if description or note:
        ws.write_comment(0, 0, (description + "\n" + note).strip(),
                         {"width": 260, "height": 110})
    report.record(ws.get_name(), category, description, len(row_labels), len(row_labels), note)
    return ws


def kpi_grid(report, ws, cards, *, start_row=2, per_row=4, width=18):
    """Render KPI cards as label-over-value pairs."""
    fmts = report.fmts
    for index, card in enumerate(cards):
        block = index // per_row
        slot = index % per_row
        first_col = slot * 2
        row = start_row + block * 3
        ws.set_column(first_col, first_col + 1, width)
        ws.merge_range(row, first_col, row, first_col + 1,
                       card["label"], fmts.kpi_label())
        value_fmt = fmts.kpi_value(card.get("color"))
        if isinstance(card["value"], str):
            ws.merge_range(row + 1, first_col, row + 1, first_col + 1,
                           card["value"], value_fmt)
        else:
            ws.merge_range(row + 1, first_col, row + 1, first_col + 1,
                           card["value"], value_fmt)
        ws.set_row(row + 1, 30)
    return start_row + ((len(cards) + per_row - 1) // per_row) * 3


def pivot(rows, row_labels, col_labels):
    """Turn (row_key, col_key, value) tuples into a dense grid."""
    r_index = {label: i for i, label in enumerate(row_labels)}
    c_index = {label: i for i, label in enumerate(col_labels)}
    grid = [[None] * len(col_labels) for _ in row_labels]
    for row_key, col_key, value in rows:
        r = r_index.get(row_key)
        c = c_index.get(col_key)
        if r is not None and c is not None:
            grid[r][c] = value
    return grid


GUILD_FILTER = "guild_id = ?"
