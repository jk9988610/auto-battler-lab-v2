import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env";
const dir = path.dirname(env.dbPath);
if (dir && dir !== "." && !fs.existsSync(dir)) {
fs.mkdirSync(dir, { recursive: true });
}
export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL");
const createUsers =
"CREATE TABLE IF NOT EXISTS users (" +
" id INTEGER PRIMARY KEY AUTOINCREMENT," +
" username TEXT NOT NULL UNIQUE," +
" password_hash TEXT NOT NULL," +
" created_at INTEGER NOT NULL" +
")";
db.exec(createUsers);
