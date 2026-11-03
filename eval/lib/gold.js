'use strict';

// Compute a question's `answer.expected` from its `answer.source`. Used by build-questions.js and
// apply-labels.js so the number is always produced by code, never typed.

function computeExpected(q, { db, A, userId }) {
  const a = q.answer;
  const s = a.source;
  const ids = q.retrieval ? q.retrieval.goldIds || [] : [];
  let v;
  if (s.sql) {
    const row = db.prepare(s.sql).all({ userId })[0];
    v = row ? Object.values(row)[0] : null;
  } else if (s.analytics) {
    v = new Function('A', 'db', 'userId', `return (${s.analytics});`)(A, db, userId);
  } else if (s.goldSum || s.goldCount) {
    const rows = ids.length
      ? db.prepare(`SELECT amount FROM transactions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    v = s.goldSum ? rows.reduce((t, r) => t + r.amount, 0) : rows.length;
  }
  if (!Number.isFinite(v)) throw new Error(`${q.id}: answer source produced ${v}`);
  return a.type === 'count' ? v : Math.round(v * 100) / 100;
}

module.exports = { computeExpected };
