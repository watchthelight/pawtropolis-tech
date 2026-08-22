"""Semantic column kinds.

Kept in its own module so theme, formats, writer and introspect can all share the
vocabulary without an import cycle.
"""

SNOWFLAKE = "snowflake_id"
UNIX_TS = "unix_ts"
ISO_DT = "iso_datetime"
BOOL = "bool01"
ENUM = "enum"
INT = "int"
REAL = "real"
JSON = "json"
TEXT = "text"

NUMERIC = (INT, REAL)
TEMPORAL = (UNIX_TS, ISO_DT)
