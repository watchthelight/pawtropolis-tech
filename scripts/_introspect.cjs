const Database = require('../web/node_modules/better-sqlite3');
const db = new Database('data/data.db', { readonly: true, fileMustExist: true });
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map(r => r.name);
console.log('TABLES:', tables.join(', '));

function cols(t) {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch { return []; }
}
// Guild id candidates
for (const t of tables) {
  if (/guild|config|server/i.test(t)) {
    const c = cols(t);
    if (c.includes('guild_id') || c.includes('guildId') || c.includes('id')) {
      try {
        const row = db.prepare(`select * from ${t} limit 1`).get();
        console.log(`\n[${t}] cols=${c.join(',')}`);
        console.log('  sample:', JSON.stringify(row).slice(0, 300));
      } catch (e) { /* ignore */ }
    }
  }
}
// Find a members-like table + a sample user id
for (const t of tables) {
  if (/member|user|application|review/i.test(t)) {
    const c = cols(t);
    const idCol = c.find(x => /^(user_id|userId|id|discord_id)$/i.test(x));
    if (idCol) {
      try {
        const row = db.prepare(`select ${idCol} as uid from ${t} where ${idCol} is not null limit 1`).get();
        console.log(`USERS[${t}.${idCol}]: ${row && row.uid}`);
      } catch (e) { /* ignore */ }
    }
  }
}
