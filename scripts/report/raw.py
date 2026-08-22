"""Raw dump tier: one fully styled sheet per remaining table."""

import writer

# Tables that exist but are not domain data. They still get dumped, because the
# brief was to include everything, but the note explains what they actually are.
ANNOTATIONS = {
    "lost_and_found": (
        "Not a domain table. This is SQLite .recover output, salvaged pages left "
        "behind by a past database recovery. Columns c0..c7 are untyped fragments."
    ),
    "message_activity": (
        "Lightweight per-message activity index used for heatmaps and rollups. "
        "The readable message content lives in the Msgs sheets."
    ),
}


def build(report, ctx, tables, covered):
    cap = ctx["args"].max_rows
    written_tables = 0

    for table in tables:
        if table.name in covered or not table.columns:
            continue

        quoted = ", ".join('"' + c.name + '"' for c in table.columns)
        rows = report.conn.execute(
            'SELECT %s FROM "%s" LIMIT %d' % (quoted, table.name, cap)
        ).fetchall()

        note = ANNOTATIONS.get(table.name, "")
        if table.rows > cap:
            truncated = (
                "Showing the first %s of %s rows, capped by --max-rows."
                % ("{:,}".format(cap), "{:,}".format(table.rows))
            )
            note = (note + " " + truncated).strip()

        writer.write_table(
            report, table.name, table.columns, rows,
            category="raw",
            description="Raw dump of the %s table." % table.name,
            expected=table.rows,
            note=note,
        )
        written_tables += 1

    return written_tables
