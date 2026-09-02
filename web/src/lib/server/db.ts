import Database from "better-sqlite3";
import path from "node:path";

const DB_BUSY_TIMEOUT_MS = 30000;

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "..", "data", "data.db");

let _db: Database.Database | undefined;

// Statement cache. Every query module prepares per call, which is a full SQL parse and
// planner run each time. Statements are shared, so callers must not call
// .pluck/.raw/.expand/.bind on them. Bounded so dynamically built SQL cannot grow it.
const STMT_CACHE_MAX = 512;

function installStatementCache(conn: Database.Database): void {
  const rawPrepare = conn.prepare.bind(conn);
  const cache = new Map<string, Database.Statement>();
  (conn as { prepare: unknown }).prepare = (sql: string) => {
    const hit = cache.get(sql);
    if (hit) return hit;
    const stmt = rawPrepare(sql);
    if (cache.size >= STMT_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(sql, stmt);
    return stmt;
  };
}

/** Lazy-initialized database connection. Deferred so SSR builds don't require a valid DB file. */
export function db(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath, { fileMustExist: true });
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    _db.pragma("query_only = ON");
    // 64MB private page cache plus a 256MB memory map. The previous 256MB cache and 1GB
    // map competed with the bot's member cache for the host's 2GB; mapped pages are the
    // shared OS page cache, so the smaller private cache costs little.
    _db.pragma("cache_size = -65536");
    _db.pragma("mmap_size = 268435456");
    _db.pragma("temp_store = MEMORY");
    installStatementCache(_db);
  }
  return _db;
}
