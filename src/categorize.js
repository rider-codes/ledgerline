'use strict';

const { db } = require('./db');

/* ------------------------------------------------------------------ *
 * Layer 1: built-in keyword rules
 * ------------------------------------------------------------------ */

// Checked in this order; first hit wins. Keep specific buckets first.
const KEYWORDS = [
  ['Housing', ['RENT', ' APT', 'APARTMENT', 'LEASING', 'PROPERTY MGMT', 'PROPERTY MANAGEMENT', 'MORTGAGE', 'HOA ', 'REALTY', 'LANDLORD']],
  ['Utilities', ['PG&E', 'PGE ', 'COMCAST', 'XFINITY', 'SPECTRUM', 'AT&T', 'VERIZON', 'T-MOBILE', 'ELECTRIC', 'GAS COMPANY', 'WATER DEPT', 'WATER DISTRICT', 'SEWER', 'UTILITY', 'DUKE ENERGY', 'CON EDISON', 'CONED', 'WASTE MGMT', 'WASTE MANAGEMENT', 'GARBAGE', 'INTERNET']],
  ['Subscriptions', ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY+', 'DISNEYPLUS', 'HBO', 'MAX.COM', 'YOUTUBEPREMIUM', 'YOUTUBE PREMIUM', 'APPLE.COM/BILL', 'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'DROPBOX', 'ADOBE', 'NYTIMES', 'WSJ', 'PATREON', 'SUBSTACK', 'AUDIBLE', 'PRIME VIDEO', 'AMAZON PRIME', 'LINKEDIN', 'NOTION', 'GITHUB', 'OPENAI', 'CHATGPT', 'PLANET FITNESS', 'GYM', 'FITNESS', 'PELOTON', 'MEMBERSHIP', 'PARAMOUNT+']],
  ['Travel', ['AIRLINE', 'AIRLINES', 'DELTA AIR', 'UNITED AIR', 'SOUTHWEST AIR', 'AMERICAN AIR', 'JETBLUE', 'ALASKA AIR', 'EXPEDIA', 'BOOKING.COM', 'AIRBNB', 'HOTEL', 'MARRIOTT', 'HILTON', 'HYATT', 'HERTZ', 'ENTERPRISE RENT', 'AVIS', 'TSA PRE']],
  ['Transport', ['UBER TRIP', 'UBER *TRIP', 'LYFT', 'SHELL', 'CHEVRON', 'EXXON', 'MOBIL', 'ARCO', 'VALERO', 'CITGO', '76 GAS', 'BART', 'MTA', 'METRO TRANSIT', 'TRANSIT', 'PARKING', 'TOLL', 'FASTRAK', 'BIRD ', 'LIME ', 'SCOOTER', 'GAS STATION', 'CALTRAIN']],
  ['Groceries', ['WHOLE FOODS', 'TRADER JOE', 'SAFEWAY', 'KROGER', 'ALDI', 'COSTCO', 'WALMART', 'INSTACART', 'SPROUTS', 'PUBLIX', 'H-E-B', 'HEB ', 'WEGMANS', 'GROCERY', 'SUPERMARKET', 'FOODS MARKET', 'RALPHS']],
  ['Dining', ['STARBUCKS', 'MCDONALD', 'CHIPOTLE', 'DOORDASH', 'UBER EATS', 'UBEREATS', 'UBER *EATS', 'GRUBHUB', 'POSTMATES', 'TACO BELL', 'SUBWAY', 'DUNKIN', 'PIZZA', 'RESTAURANT', ' CAFE', 'COFFEE', 'BLUE BOTTLE', 'SWEETGREEN', 'PANERA', 'KFC', 'WENDY', 'CHICK-FIL', 'BISTRO', 'TARTINE', 'DELI', 'BAKERY', 'BREWING', 'TAQUERIA', 'RAMEN', 'SUSHI', 'THAI ', 'DINER']],
  ['Health', ['CVS', 'WALGREENS', 'RITE AID', 'PHARMACY', 'KAISER', 'BLUE CROSS', 'BLUE SHIELD', 'DENTAL', 'DENTIST', 'CLINIC', 'HOSPITAL', 'MEDICAL', 'OPTOMETRY', 'VISION CENTER', 'LABCORP', 'QUEST DIAG', 'THERAPY', 'URGENT CARE']],
  ['Education', ['UDEMY', 'COURSERA', 'UNIVERSITY', 'COLLEGE', 'TUITION', 'KHAN ACADEMY', 'DUOLINGO', 'PLURALSIGHT', 'TEXTBOOK', 'EDX', 'SKILLSHARE', 'STUDENT LOAN']],
  ['Entertainment', ['AMC ', 'CINEMARK', 'REGAL CINEMA', 'MOVIE', 'STEAM GAMES', 'STEAMGAMES', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'TICKETMASTER', 'LIVE NATION', 'EVENTBRITE', 'FANDANGO', 'BOWLING', 'GOLF ', 'ARCADE', 'MUSEUM']],
  ['Shopping', ['AMAZON', 'AMZN', 'TARGET', 'BEST BUY', 'IKEA', 'NIKE', 'ADIDAS', 'MACY', 'NORDSTROM', 'ETSY', 'EBAY', 'H&M', 'ZARA', 'UNIQLO', 'SEPHORA', 'ULTA', 'WAYFAIR', 'HOME DEPOT', 'LOWES', 'APPLE STORE', 'REI ']],
];

function keywordCategory(rawText) {
  const t = ` ${String(rawText || '').toUpperCase()} `;
  for (const [cat, needles] of KEYWORDS) {
    for (const n of needles) {
      if (t.includes(n)) return cat;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Layer 2: user-defined rules (rules table)
 * ------------------------------------------------------------------ */

function userRuleCategory(userId, rawText) {
  const t = String(rawText || '').toUpperCase();
  const rows = db
    .prepare('SELECT match_text, category FROM rules WHERE user_id = ? ORDER BY length(match_text) DESC, id ASC')
    .all(userId);
  for (const r of rows) {
    if (t.includes(String(r.match_text).toUpperCase())) return r.category;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Layer 3: Naive Bayes text classifier, trained on the user's own edits
 * ------------------------------------------------------------------ */

const NB_MIN_DOCS = 15;
const NB_MIN_CONFIDENCE = 0.62;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((tok) => tok.length >= 2 && tok.length <= 24 && !/^\d+$/.test(tok));
}

function loadModel(userId) {
  const row = db.prepare('SELECT payload FROM nb_model WHERE user_id = ?').get(userId);
  if (!row) return { docs: 0, classDocs: {}, tokens: {}, classTokens: {}, vocab: {} };
  try {
    const m = JSON.parse(row.payload);
    return {
      docs: m.docs || 0,
      classDocs: m.classDocs || {},
      tokens: m.tokens || {},
      classTokens: m.classTokens || {},
      vocab: m.vocab || {},
    };
  } catch {
    return { docs: 0, classDocs: {}, tokens: {}, classTokens: {}, vocab: {} };
  }
}

function saveModel(userId, model) {
  db.prepare(
    `INSERT INTO nb_model (user_id, payload, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(model));
}

function trainModel(model, text, category) {
  const toks = tokenize(text);
  if (!toks.length) return model;
  model.docs += 1;
  model.classDocs[category] = (model.classDocs[category] || 0) + 1;
  model.tokens[category] = model.tokens[category] || {};
  for (const tok of toks) {
    model.tokens[category][tok] = (model.tokens[category][tok] || 0) + 1;
    model.classTokens[category] = (model.classTokens[category] || 0) + 1;
    model.vocab[tok] = 1;
  }
  return model;
}

// Public: record one correction and persist.
function learn(userId, text, category) {
  const model = loadModel(userId);
  trainModel(model, text, category);
  saveModel(userId, model);
}

function predict(userId, text, modelArg) {
  const model = modelArg || loadModel(userId);
  const toks = tokenize(text);
  const classes = Object.keys(model.classDocs);
  if (model.docs < NB_MIN_DOCS || classes.length === 0 || toks.length === 0) {
    return { category: null, confidence: 0 };
  }
  const V = Math.max(1, Object.keys(model.vocab).length);
  const logp = {};
  for (const c of classes) {
    let lp = Math.log(model.classDocs[c] / model.docs);
    const denom = (model.classTokens[c] || 0) + V;
    const tc = model.tokens[c] || {};
    for (const tok of toks) {
      lp += Math.log(((tc[tok] || 0) + 1) / denom);
    }
    logp[c] = lp;
  }
  // softmax for a comparable confidence
  const max = Math.max(...Object.values(logp));
  let sum = 0;
  const exp = {};
  for (const c of classes) {
    exp[c] = Math.exp(logp[c] - max);
    sum += exp[c];
  }
  let best = null;
  let bestP = 0;
  for (const c of classes) {
    const p = exp[c] / sum;
    if (p > bestP) {
      bestP = p;
      best = c;
    }
  }
  return { category: best, confidence: bestP };
}

/* ------------------------------------------------------------------ *
 * Merchant text helpers
 * ------------------------------------------------------------------ */

// A tidy display name from a raw bank description.
function normalizeMerchant(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\s+/g, ' ');
  // strip common processor prefixes
  s = s.replace(/^(SQ|TST|SP|PY|PayPal|PAYPAL)\s*\*+\s*/i, '');
  s = s.replace(/^POS\s+/i, '').replace(/^PURCHASE\s+/i, '').replace(/^DEBIT\s+CARD\s+/i, '');
  // strip trailing store numbers / ref codes / state+zip tails
  s = s.replace(/\s+#?\d{3,}$/i, '');
  s = s.replace(/\s+[A-Z]{2}\s*\d{4,}$/i, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return String(raw || '').trim();
  // Title-case if it's all caps
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * The resolver used at import time
 * ------------------------------------------------------------------ */

const KNOWN = new Set(require('./db').CATEGORIES);

// Returns { category, via } where via is 'csv' | 'rule' | 'keyword' | 'model' | 'fallback'
function categorize(userId, rawText, csvCategory) {
  if (csvCategory && KNOWN.has(csvCategory)) {
    return { category: csvCategory, via: 'csv' };
  }
  const rule = userRuleCategory(userId, rawText);
  if (rule) return { category: rule, via: 'rule' };

  const kw = keywordCategory(rawText);
  if (kw) return { category: kw, via: 'keyword' };

  const p = predict(userId, rawText);
  if (p.category && p.confidence >= NB_MIN_CONFIDENCE) {
    return { category: p.category, via: 'model', confidence: p.confidence };
  }
  return { category: 'Uncategorized', via: 'fallback' };
}

module.exports = {
  categorize,
  keywordCategory,
  userRuleCategory,
  predict,
  learn,
  loadModel,
  saveModel,
  trainModel,
  normalizeMerchant,
  NB_MIN_CONFIDENCE,
};
