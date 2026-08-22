"""Navigation and reference sheets: contents, schema map, skipped tables, run log."""

import theme
import writer
from kinds import INT, TEXT
from writer import col

REFERENCE = "reference"


def _quote_sheet(name):
    return "'" + name.replace("'", "''") + "'"


def write_contents(report, ws, ctx):
    """Fill the reserved first worksheet once every other sheet exists."""
    fmts = report.fmts
    ws.hide_gridlines(2)
    ws.write_string(0, 0, "Contents", fmts.title())
    ws.write_string(
        1, 0,
        "%d sheets. Click a name to jump. Tab colours group sheets by domain."
        % len(report.entries),
        fmts.subtitle(),
    )

    headers = ["Sheet", "", "Category", "Rows", "In Source", "Status", "Description"]
    widths = [30, 3, 15, 12, 12, 14, 78]
    header_fmt = fmts.header()
    top = 3
    for idx, (title, width) in enumerate(zip(headers, widths)):
        ws.set_column(idx, idx, width)
        ws.write_string(top, idx, title, header_fmt)
    ws.set_row(top, 26)

    link_fmt = fmts.link()
    text_fmt = fmts.cell(TEXT)
    int_fmt = fmts.cell(INT)

    order = {name: i for i, name in enumerate(theme.CATEGORY_ORDER)}
    entries = sorted(
        report.entries,
        key=lambda e: (order.get(e["category"], 99), e["sheet"].lower()),
    )

    for offset, entry in enumerate(entries):
        row = top + 1 + offset
        target = "internal:" + _quote_sheet(entry["sheet"]) + "!A1"
        ws.write_url(row, 0, target, link_fmt, string=entry["sheet"])
        ws.write_blank(row, 1, None,
                       fmts.chip(theme.CATEGORY_COLOR.get(entry["category"], theme.GREY)))
        ws.write_string(row, 2, entry["category"], text_fmt)
        ws.write_number(row, 3, entry["written"], int_fmt)
        ws.write_number(row, 4, entry["expected"], int_fmt)

        if entry["written"] == entry["expected"]:
            status, fmt = "complete", text_fmt
        elif entry["note"]:
            status, fmt = "sampled", fmts.warn_cell()
        else:
            status, fmt = "MISMATCH", fmts.warn_cell()
        ws.write_string(row, 5, status, fmt)
        ws.write_string(row, 6, entry["description"], text_fmt)

    last = top + len(entries)
    if entries:
        ws.autofilter(top, 0, last, len(headers) - 1)
        ws.conditional_format(top + 1, 3, last, 4, {
            "type": "data_bar", "bar_color": theme.BAR_POS, "bar_solid": False,
        })
    ws.freeze_panes(top + 1, 0)


def write_schema_map(report, tables):
    rows = []
    for table in tables:
        for position, column in enumerate(table.columns):
            rows.append((
                table.name, position, column.name, column.decl_type or "(none)",
                column.kind, "yes" if column.pk else "", "yes" if column.notnull else "",
                ", ".join(column.distinct) if column.distinct else "",
            ))
    writer.write_table(
        report, "Schema Map",
        [col("Table", TEXT, 28), col("#", INT, 6), col("Column", TEXT, 28),
         col("Declared Type", TEXT, 15), col("Inferred Kind", TEXT, 16),
         col("PK", TEXT, 6), col("Not Null", TEXT, 10), col("Enum Values", TEXT, 50)],
        rows,
        category=REFERENCE,
        description="Every column in the database with its inferred semantic kind.",
        note="Inferred kind drives number format and conditional formatting.",
    )


def write_skipped(report, skipped):
    rows = [
        (t.name, t.rows if t.rows >= 0 else "", t.skip_reason)
        for t in skipped
    ]
    writer.write_table(
        report, "Tables Not Dumped",
        [col("Table", TEXT, 32), col("Rows", TEXT, 10), col("Reason", TEXT, 52)],
        rows,
        category=REFERENCE,
        description="Tables present in the database but deliberately not given a sheet.",
    )


def write_run_metadata(report, ctx, stats):
    rows = [(k, str(v)) for k, v in stats]
    if report.warnings:
        rows.append(("warnings", str(len(report.warnings))))
        for index, message in enumerate(report.warnings, 1):
            rows.append(("warning %d" % index, message))
    writer.write_table(
        report, "Run Metadata",
        [col("Key", TEXT, 30), col("Value", TEXT, 90)],
        rows,
        category=REFERENCE,
        description="How this workbook was produced, and against what data.",
    )


def reconciliation_failures(report):
    """Sheets whose written row count does not match source and was not sampled."""
    return [
        e for e in report.entries
        if e["written"] != e["expected"] and not e["note"]
    ]
