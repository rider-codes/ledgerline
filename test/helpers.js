'use strict';

// Builds a throwaway SQLite database for unit tests. Must be required BEFORE anything in src/,
// because src/db.js opens DB_PATH at require time. Never touches data/finance.db.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const file = path.join(os.tmpdir(), `ledgerline-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = file;
process.env.CURRENCY = '₹';
process.env.AI_BACKEND = 'rules';
process.env.EMBED_ENABLED = 'false';

const { db } = require('../src/db');

db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (1, 'test@example.com', 'x', 'Test')").run();
const ins = db.prepare('INSERT INTO transactions (user_id, date, amount, type, category, merchant) VALUES (1, ?, ?, ?, ?, ?)');
const add = (date, amount, type, category, merchant) => ins.run(date, amount, type, category, merchant);

db.exec('BEGIN');
add('2026-08-03', 45, 'expense', 'Dining', 'Chipotle');
add('2026-08-10', 120, 'expense', 'Dining', 'Nobu');
add('2026-08-12', 12.5, 'expense', 'Dining', 'Philz Coffee');
add('2026-07-05', 30, 'expense', 'Dining', 'Chipotle');
add('2026-08-15', 600, 'expense', 'Shopping', 'Best Buy');
add('2026-08-20', 80, 'expense', 'Health', 'City Doctor Clinic');
add('2025-10-05', 25, 'expense', 'Groceries', 'Supermarket Fresh');
add('2026-03-09', 40, 'expense', 'Groceries', 'Supermarket Fresh');
add('2026-08-01', 3000, 'income', 'Income', 'Payroll');
add('2026-07-01', 3000, 'income', 'Income', 'Payroll');
add('2025-08-14', 55, 'expense', 'Dining', 'Old Diner');
for (let i = 1; i <= 30; i++) add(`2026-06-${String(i).padStart(2, '0')}`, 10, 'expense', 'Groceries', 'Corner Store');
add('2020-01-15', 18, 'expense', 'Shopping', 'Old Bookshop');
for (let i = 0; i < 900; i++) add(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 5, 'expense', 'Transport', `Bus ticket ${i}`);
db.exec('COMMIT');

process.on('exit', () => {
  try { db.close(); } catch { /* already closed */ }
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
});

module.exports = { db, USER: 1, DEFAULT_MONTH: '2026-09' };
