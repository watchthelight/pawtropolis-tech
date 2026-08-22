"""Schema discovery and semantic column typing.

Column kind is inferred from the column name, its declared type, and a sample of
real values. The declared type alone is not enough: SQLite stores Discord
snowflakes, unix timestamps, booleans and ISO datetime strings all as TEXT or
INTEGER, and they need very different Excel treatment.
"""

import re
from dataclasses import dataclass, field

from kinds import BOOL, ENUM, INT, ISO_DT, JSON, REAL, SNOWFLAKE, TEXT, UNIX_TS

SAMPLE_SIZE = 500
ENUM_MAX_DISTINCT = 12
ENUM_MIN_SAMPLE = 20
DISTINCT_SCAN_LIMIT = 250_000

# Real columns are not uniformly clean: application.user_id carries about 7 per
# cent leftover test values, and application.created_at holds a mix of ISO
# datetimes and epoch-as-string. Requiring every sampled value to match would
# demote both to plain text and lose their formatting, so classification is by
# majority and the writer coerces defensively per value.
MATCH_RATIO = 0.8

_SNOWFLAKE_RE = re.compile(r"^\d{17,20}$")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}|$)")
_FTS_SHADOW_RE = re.compile(r"_fts_(data|idx|docsize|config|content)$")
_FTS_MAIN_RE = re.compile(r"_fts$")

_TS_MIN = 1_000_000_000
_TS_MAX = 4_000_000_000

INTERNAL_EXACT = {
    "_litestream_seq", "_litestream_lock", "sqlite_sequence", "sqlite_stat1",
}


@dataclass
class Column:
    name: str
    decl_type: str
    notnull: bool
    pk: bool
    kind: str = TEXT
    width: int = 12
    distinct: tuple = ()


@dataclass
class Table:
    name: str
    rows: int
    columns: list = field(default_factory=list)
    skip_reason: str = ""


def skip_reason_for(name):
    if name in INTERNAL_EXACT or name.startswith("sqlite_"):
        return "sqlite or litestream internal"
    if _FTS_SHADOW_RE.search(name):
        return "FTS5 shadow table (binary index storage)"
    if _FTS_MAIN_RE.search(name):
        return "FTS5 index, duplicates its source table"
    return ""


def _ratio(predicate, values):
    if not values:
        return 0.0
    return sum(1 for v in values if predicate(v)) / len(values)


def _is_id_name(lname):
    return lname == "id" or lname.endswith("_id") or lname.endswith("_ids")


def infer_kind(name, decl_type, samples):
    """Best-effort semantic kind for one column."""
    lname = (name or "").lower()
    decl = (decl_type or "").upper()
    vals = [v for v in samples if v is not None]

    if not vals:
        if "INT" in decl:
            return INT
        if any(t in decl for t in ("REAL", "FLOA", "DOUB", "NUM")):
            return REAL
        return TEXT

    strs = [v for v in vals if isinstance(v, str)]
    ints = [v for v in vals if isinstance(v, int) and not isinstance(v, bool)]
    floats = [v for v in vals if isinstance(v, float)]

    if _ratio(lambda v: isinstance(v, str), vals) >= MATCH_RATIO:
        if _ratio(lambda v: bool(_SNOWFLAKE_RE.match(v)), strs) >= MATCH_RATIO:
            return SNOWFLAKE
        if lname.endswith("_json") or _ratio(lambda v: v[:1] in "{[", strs) >= MATCH_RATIO:
            return JSON
        if _ratio(lambda v: bool(_ISO_RE.match(v)), strs) >= MATCH_RATIO:
            return ISO_DT
        # An identifier must never become an enum. Enum cells are written with a
        # General format, which lets Excel parse a 19 digit snowflake as a float
        # and silently destroy the last digits.
        if _is_id_name(lname):
            return TEXT
        if len({*strs}) <= ENUM_MAX_DISTINCT and len(strs) >= ENUM_MIN_SAMPLE:
            return ENUM
        return TEXT

    if _ratio(lambda v: isinstance(v, int) and not isinstance(v, bool), vals) >= MATCH_RATIO:
        if _is_id_name(lname) and _ratio(lambda v: v > 10**16, ints) >= MATCH_RATIO:
            return SNOWFLAKE
        if set(ints) <= {0, 1}:
            return BOOL
        looks_temporal = (
            lname.endswith("_s") or "_at" in lname or lname in ("ts", "timestamp")
            or lname.endswith("_time") or lname.endswith("_date")
        )
        if looks_temporal and _ratio(lambda v: _TS_MIN <= v <= _TS_MAX, ints) >= MATCH_RATIO:
            return UNIX_TS
        return INT

    if floats:
        return REAL
    if ints:
        return INT
    return TEXT


def _sample_width(samples, header):
    widest = len(str(header))
    for v in samples[:200]:
        if v is None:
            continue
        widest = max(widest, len(str(v)))
    return max(9, min(52, widest + 2))


SAMPLE_BUCKETS = 25


def _sample_rows(conn, name, quoted, rows):
    """Sample spread evenly across the rowid space.

    Contiguous head or tail samples misread tables whose seed and test rows are
    clustered at one end. application is the clear case: its first 250 rows are
    74 per cent fixtures, its last 250 are entirely real, so neither end alone
    reflects the table. Walking buckets across the rowid range costs a handful of
    index seeks and stays fast on the multi-million row tables.
    """
    if rows <= SAMPLE_SIZE:
        return conn.execute(f'SELECT {quoted} FROM "{name}"').fetchall()

    try:
        lo, hi = conn.execute(f'SELECT MIN(rowid), MAX(rowid) FROM "{name}"').fetchone()
    except Exception:
        lo = hi = None
    if lo is None or hi is None or hi <= lo:
        return conn.execute(f'SELECT {quoted} FROM "{name}" LIMIT {SAMPLE_SIZE}').fetchall()

    per_bucket = max(1, SAMPLE_SIZE // SAMPLE_BUCKETS)
    span = (hi - lo) / SAMPLE_BUCKETS
    out = []
    for bucket in range(SAMPLE_BUCKETS):
        start = int(lo + span * bucket)
        out += conn.execute(
            f'SELECT {quoted} FROM "{name}" WHERE rowid >= ? LIMIT {per_bucket}',
            (start,),
        ).fetchall()
    return out or conn.execute(
        f'SELECT {quoted} FROM "{name}" LIMIT {SAMPLE_SIZE}'
    ).fetchall()


def describe(conn, name, rows):
    cur = conn.execute(f'PRAGMA table_info("{name}")')
    info = cur.fetchall()
    cols = [
        Column(name=r[1], decl_type=r[2] or "", notnull=bool(r[3]), pk=bool(r[5]))
        for r in info
    ]
    if not cols:
        return Table(name=name, rows=rows, columns=[])

    quoted = ", ".join(f'"{c.name}"' for c in cols)
    sample_rows = _sample_rows(conn, name, quoted, rows)

    for idx, col in enumerate(cols):
        samples = [r[idx] for r in sample_rows]
        col.kind = infer_kind(col.name, col.decl_type, samples)
        col.width = _sample_width(samples, col.name)
        if col.kind == ENUM and rows <= DISTINCT_SCAN_LIMIT:
            found = conn.execute(
                f'SELECT DISTINCT "{col.name}" FROM "{name}" '
                f'WHERE "{col.name}" IS NOT NULL LIMIT {ENUM_MAX_DISTINCT + 1}'
            ).fetchall()
            if len(found) <= ENUM_MAX_DISTINCT:
                col.distinct = tuple(sorted(str(r[0]) for r in found))
            else:
                col.kind = TEXT
    return Table(name=name, rows=rows, columns=cols)


def discover(conn, progress=None):
    """Return (usable_tables, skipped_tables), each sorted by row count desc."""
    names = [
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    ]
    usable, skipped = [], []
    for name in names:
        reason = skip_reason_for(name)
        if reason:
            skipped.append(Table(name=name, rows=-1, skip_reason=reason))
            continue
        try:
            rows = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        except Exception as exc:
            skipped.append(Table(name=name, rows=-1, skip_reason=f"unreadable: {exc}"))
            continue
        if progress:
            progress(name, rows)
        if rows == 0:
            skipped.append(Table(name=name, rows=0, skip_reason="empty"))
            continue
        usable.append(describe(conn, name, rows))
    usable.sort(key=lambda t: -t.rows)
    skipped.sort(key=lambda t: t.name)
    return usable, skipped
