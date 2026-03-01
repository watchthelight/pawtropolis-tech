import Database from "better-sqlite3";
import path from "node:path";

const DB_BUSY_TIMEOUT_MS = 5000;

const dbPath =
	process.env.DB_PATH ||
	path.resolve(process.cwd(), "..", "data", "data.db");

export const db = new Database(dbPath, { fileMustExist: true });

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
db.pragma("query_only = ON");
