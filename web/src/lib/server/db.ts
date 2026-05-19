import Database from "better-sqlite3";
import path from "node:path";

const DB_BUSY_TIMEOUT_MS = 30000;

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "..", "data", "data.db");

let _db: Database.Database | undefined;

/** Lazy-initialized database connection. Deferred so SSR builds don't require a valid DB file. */
export function db(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath, { fileMustExist: true });
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    _db.pragma("query_only = ON");
    _db.pragma("cache_size = -262144");
    _db.pragma("mmap_size = 1073741824");
    _db.pragma("temp_store = MEMORY");
  }
  return _db;
}
