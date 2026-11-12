'use strict';

/*
 * Creates a demo account with over a year of realistic transactions (Jul 2025 to Sep 2026).
 *   npm run seed                -> wipe the demo user's data and regenerate
 *   npm run reset               -> wipe ALL data, then regenerate the demo user
 *   npm run seed -- --legacy    -> only the original May-Sep 2026 block (what the eval was labelled on)
 *
 * Deterministic: a fixed RNG seed means the same data every run.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { learn } = require('./categorize');

const RESET = process.argv.includes('--reset');
const LEGACY = process.argv.includes('--legacy'); // only the original May-Sep 2026 block (matches the eval's demo questions)
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo1234';
const MONTHLY_INCOME = 6200;
const START = '2026-05-01';
const END = '2026-09-06';

/* ---- seeded RNG (mulberry32) ---- */
let _s = 0x9e3779b9;
function rng() {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = (min, max) => min + rng() * (max - min);
const money = (min, max) => Math.round(rand(min, max) * 100) / 100;
const chance = (p) => rng() < p;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

/* ---- date helpers ---- */
function eachDay(startISO, endISO, fn) {
  const d = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (d <= end) {
    fn(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
const iso = (d) => d.toISOString().slice(0, 10);

/* ---- merchant pools ---- */
const M = {
  Groceries: ['Whole Foods Market', "Trader Joe's", 'Safeway', 'Sprouts Farmers Market', 'Costco Wholesale'],
  Dining: ['Blue Bottle Coffee', 'Chipotle', 'Sweetgreen', 'Tartine Bakery', 'DoorDash', 'Philz Coffee', 'Curry Up Now', 'Marufuku Ramen'],
  Transport: ['BART', 'Shell', 'Chevron', 'Lyft', 'Bird Scooter'],
  Shopping: ['Amazon', 'Target', 'Best Buy', 'REI', 'Uniqlo'],
  Entertainment: ['AMC Metreon', 'Steam Games', 'Ticketmaster'],
  Health: ['CVS Pharmacy', 'Walgreens', 'Kaiser Permanente'],
  Travel: ['Alaska Airlines', 'Marriott Hotels'],
  Education: ['Udemy'],
};

/* ---- the year before: Jul 2025 .. Apr 2026 ----
 * Generated AFTER the May-Sep 2026 block, from its own RNG stream, so that block's rows (and their
 * ids) are exactly what they were before this existed: the eval's demo-account questions are
 * labelled against them. `npm run seed -- --legacy` reproduces that original dataset. */
const HISTORY_START = '2025-07-01';
const HISTORY_END = '2026-04-30';

function addHistory(add) {
  _s = 0x1b873593;
  let count = 0;
  const put = (...a) => { add(...a); count++; };
  eachDay(HISTORY_START, HISTORY_END, (d) => {
    const day = d.getUTCDate();
    const month = d.getUTCMonth(); // 0-11
    const year = d.getUTCFullYear();
    const dow = d.getUTCDay();
    const date = iso(d);
    const december = month === 11; // gifts, parties, travel
    const winter = month === 11 || month === 0 || month === 1; // heating bills
    const raised = year === 2026; // new lease and a raise from January

    // --- income and fixed costs ---
    if (day === 1 || day === 15) put(date, (raised ? 6200 : 5900) / 2, 'income', 'Income', 'Payroll — Northwind Labs');
    if (december && day === 20) put(date, 1500, 'income', 'Income', 'Year-end bonus — Northwind Labs');
    if (day === 1) put(date, raised ? 1750 : 1700, 'expense', 'Housing', 'Sterling Apartments');
    if (day === 8) put(date, winter ? money(128, 171) : money(96, 124), 'expense', 'Utilities', 'PG&E');
    if (day === 12) put(date, raised ? 79.99 : 69.99, 'expense', 'Utilities', 'Comcast Xfinity');
    if (day === 2) put(date, 24.99, 'expense', 'Subscriptions', 'Planet Fitness');
    if (day === 3) put(date, raised ? 15.49 : 13.99, 'expense', 'Subscriptions', 'Netflix');
    if (day === 5) put(date, 2.99, 'expense', 'Subscriptions', 'iCloud');
    if (day === 7) put(date, 11.99, 'expense', 'Subscriptions', 'Spotify');
    if (day === 9) put(date, 14.95, 'expense', 'Subscriptions', 'Audible');

    // --- groceries ~2x / week, dining ~3x / week (more in December) ---
    if (chance(2 / 7)) put(date, chance(0.15) ? money(120, 190) : money(32, 96), 'expense', 'Groceries', pick(M.Groceries));
    for (let i = 0; i < (december ? 2 : 1); i++) {
      if (chance(december ? 0.4 : 3 / 7)) {
        const merchant = pick(M.Dining);
        const amt = merchant === 'DoorDash' ? money(26, 58) : /coffee/i.test(merchant) ? money(4.5, 9.5) : money(11, 27);
        put(date, amt, 'expense', 'Dining', merchant);
      }
    }

    // --- transport ---
    if (dow >= 1 && dow <= 5 && chance(0.55)) put(date, money(2.5, 8.25), 'expense', 'Transport', 'BART');
    if (chance(1 / 12)) put(date, money(42, 66), 'expense', 'Transport', chance(0.5) ? 'Shell' : 'Chevron');
    if (chance(1 / 14)) put(date, money(12, 29), 'expense', 'Transport', 'Lyft');

    // --- shopping: ~weekly, heavier in the holiday season ---
    if (chance(december ? 0.35 : 1 / 7)) put(date, december ? money(25, 140) : money(14, 78), 'expense', 'Shopping', pick(M.Shopping));
    if (month === 10 && day === 28) { put(date, 94.5, 'expense', 'Shopping', 'Amazon'); put(date, 128.2, 'expense', 'Shopping', 'Amazon'); put(date, 214, 'expense', 'Shopping', 'Best Buy'); } // Black Friday

    // --- occasional ---
    if (chance(1 / 16)) put(date, money(12, 44), 'expense', 'Health', pick(M.Health));
    if (day === 15 && month === 0) put(date, 40, 'expense', 'Health', 'Kaiser Permanente');
    if (chance(1 / 18)) put(date, money(14, 34), 'expense', 'Entertainment', pick(M.Entertainment));
    if (december && day === 14) put(date, 86, 'expense', 'Entertainment', 'Ticketmaster');
    if (december && day === 21) put(date, 412, 'expense', 'Travel', 'Alaska Airlines');
    if (december && day === 22) put(date, 248, 'expense', 'Travel', 'Marriott Hotels');
    if (december && day === 28) put(date, 389, 'expense', 'Travel', 'Alaska Airlines');
    if (month === 2 && day === 10) put(date, 29.99, 'expense', 'Education', 'Udemy');
    if (month === 8 && day === 18) put(date, 12.99, 'expense', 'Education', 'Udemy');
  });
  return count;
}

// Fill a user with the demo dataset: Jul 2025 to Sep 2026 (~900 transactions), a few rules and a
// warmed-up classifier. { legacy: true } gives only the original May-Sep 2026 block (~270).
// The RNG is re-seeded on every call, so each user gets identical data. The caller owns the
// user row (and any surrounding transaction).
function seedUserData(uid, { legacy = false } = {}) {
  _s = 0x9e3779b9;
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, date, amount, type, category, merchant, note, source)
     VALUES (?, ?, ?, ?, ?, ?, '', 'seed')`
  );
  const add = (date, amount, type, category, merchant) =>
    insert.run(uid, date, Math.round(amount * 100) / 100, type, category, merchant);

  let count = 0;
  eachDay(START, END, (d) => {
    const day = d.getUTCDate();
    const month = d.getUTCMonth(); // 0-11
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    const date = iso(d);
    const augustSpike = month === 7; // August -> deliberate Dining/Shopping bump

    // --- income & fixed monthly costs ---
    if (day === 1 || day === 15) {
      add(date, MONTHLY_INCOME / 2, 'income', 'Income', 'Payroll — Northwind Labs');
      count++;
    }
    if (day === 1) { add(date, 1750, 'expense', 'Housing', 'Sterling Apartments'); count++; }
    if (day === 8) { add(date, money(104, 132), 'expense', 'Utilities', 'PG&E'); count++; }
    if (day === 12) { add(date, 79.99, 'expense', 'Utilities', 'Comcast Xfinity'); count++; }
    if (day === 2) { add(date, 24.99, 'expense', 'Subscriptions', 'Planet Fitness'); count++; }
    if (day === 3) { add(date, 15.49, 'expense', 'Subscriptions', 'Netflix'); count++; }
    if (day === 5) { add(date, 2.99, 'expense', 'Subscriptions', 'iCloud'); count++; }
    if (day === 7) { add(date, 11.99, 'expense', 'Subscriptions', 'Spotify'); count++; }
    if (day === 9) { add(date, 14.95, 'expense', 'Subscriptions', 'Audible'); count++; }

    // --- groceries ~2x / week ---
    if (chance(2 / 7)) {
      const big = chance(0.15);
      add(date, big ? money(120, 190) : money(32, 96), 'expense', 'Groceries', pick(M.Groceries));
      count++;
    }

    // --- dining ~3x / week (x1.5 in August) ---
    const diningDraws = augustSpike ? 2 : 1;
    for (let i = 0; i < diningDraws; i++) {
      if (chance(augustSpike ? 0.42 : 3 / 7)) {
        const merchant = pick(M.Dining);
        let amt;
        if (merchant === 'DoorDash') amt = money(26, 58);
        else if (/coffee/i.test(merchant)) amt = money(4.5, 9.5);
        else amt = money(11, 27);
        add(date, amt, 'expense', 'Dining', merchant);
        count++;
      }
    }

    // --- transport ---
    if (dow >= 1 && dow <= 5 && chance(0.55)) {
      add(date, money(2.5, 8.25), 'expense', 'Transport', 'BART');
      count++;
    }
    if (chance(1 / 12)) {
      add(date, money(42, 66), 'expense', 'Transport', chance(0.5) ? 'Shell' : 'Chevron');
      count++;
    }
    if (chance(1 / 14)) { add(date, money(12, 29), 'expense', 'Transport', 'Lyft'); count++; }

    // --- shopping ~1x / week (+ two big Amazon orders on Aug 12) ---
    if (chance(1 / 7)) {
      add(date, money(14, 78), 'expense', 'Shopping', pick(M.Shopping));
      count++;
    }
    if (augustSpike && day === 12) {
      add(date, 82.4, 'expense', 'Shopping', 'Amazon');
      add(date, 81.6, 'expense', 'Shopping', 'Amazon');
      count += 2;
    }

    // --- occasional ---
    if (chance(1 / 16)) { add(date, money(12, 44), 'expense', 'Health', pick(M.Health)); count++; }
    if (day === 20 && (month === 5 || month === 7)) { add(date, 40, 'expense', 'Health', 'Kaiser Permanente'); count++; }
    if (chance(1 / 18)) { add(date, money(14, 34), 'expense', 'Entertainment', pick(M.Entertainment)); count++; }
    if (month === 6 && day === 18) { add(date, 322, 'expense', 'Travel', 'Alaska Airlines'); count++; }
    if (month === 6 && day === 19) { add(date, 186, 'expense', 'Travel', 'Marriott Hotels'); count++; }
    if (month === 5 && day === 22) { add(date, 12.99, 'expense', 'Education', 'Udemy'); count++; }
  });

  if (!legacy) count += addHistory(add);

  // --- a few user rules so the Rules screen isn't empty ---
  const addRule = db.prepare('INSERT INTO rules (user_id, match_text, category) VALUES (?, ?, ?)');
  [
    ['NETFLIX', 'Subscriptions'],
    ['WHOLE FOODS', 'Groceries'],
    ['BART', 'Transport'],
    ['DOORDASH', 'Dining'],
    ['PG&E', 'Utilities'],
  ].forEach(([m, c]) => addRule.run(uid, m, c));

  // --- warm the Naive Bayes model with ~30 examples from the generated merchants ---
  const examples = [];
  for (const [cat, list] of Object.entries(M)) {
    for (const m of list) examples.push([m, cat]);
  }
  examples.push(['Payroll Northwind Labs direct deposit', 'Income']);
  examples.push(['Sterling Apartments rent', 'Housing']);
  examples.push(['Comcast Xfinity internet', 'Utilities']);
  examples.push(['Netflix subscription', 'Subscriptions']);
  examples.push(['Spotify premium', 'Subscriptions']);
  for (const [text, cat] of examples) learn(uid, text, cat);
  return { count, rules: 5, examples: examples.length };
}

// CLI: the shared local demo account (demo@example.com).
function run() {
  if (RESET) {
    db.exec('DELETE FROM transactions; DELETE FROM rules; DELETE FROM nb_model; DELETE FROM users;');
    console.log('reset: all data cleared');
  }

  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
  if (user) {
    db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM rules WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM nb_model WHERE user_id = ?').run(user.id);
  } else {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(DEMO_EMAIL, hash, 'Demo User');
    user = { id: Number(info.lastInsertRowid) };
  }
  const r = seedUserData(user.id, { legacy: LEGACY });
  console.log(`seeded: demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`        ${r.count} transactions from ${LEGACY ? START : HISTORY_START} to ${END}${LEGACY ? ' (legacy range)' : ''}`);
  console.log(`        ${r.rules} rules, Naive Bayes warmed with ${r.examples} examples`);
}

if (require.main === module) {
  run();
  db.close();
}

module.exports = { seedUserData, START, END };
