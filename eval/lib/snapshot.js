'use strict';

// Content hash of the eval snapshot. Hashes the rows of users, transactions and tx_embed (ordered by
// primary key), not the file bytes: opening the file through src/db.js switches journal mode and would
// change a file hash without changing any data.

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TABLES = {
  users: 'SELECT id, email, password_hash, name, created_at FROM users ORDER BY id',
  transactions: 'SELECT id, user_id, date, amount, type, category, merchant, note, source, import_hash, created_at FROM transactions ORDER BY id',
  tx_embed: 'SELECT transaction_id, model, dim, doc_hash, vec, updated_at FROM tx_embed ORDER BY transaction_id',
};

function contentHash(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const h = crypto.createHash('sha256');
  const rows = {};
  try {
    for (const [name, sql] of Object.entries(TABLES)) {
      h.update(`\n#${name}\n`);
      const all = db.prepare(sql).all();
      rows[name] = all.length;
      for (const r of all) {
        h.update(JSON.stringify(Object.values(r).map((v) => (v instanceof Uint8Array ? `x:${Buffer.from(v).toString('hex')}` : v))));
        h.update('\n');
      }
    }
  } finally {
    db.close();
  }
  return { sha256: h.digest('hex'), rows };
}

module.exports = { contentHash };
