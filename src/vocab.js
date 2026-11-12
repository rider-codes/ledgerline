'use strict';

// Shared natural-language vocabulary used by the assistant and the retriever.

const CAT_SYNONYMS = {
  Dining: ['dining', 'eating out', 'eat out', 'ate', 'eaten', 'dined', 'lunch', 'dinner', 'brunch', 'restaurants', 'restaurant', 'takeout', 'take out', 'take-out', 'delivery', 'coffee', 'doordash', 'uber eats', 'ubereats'],
  Groceries: ['groceries', 'grocery', 'supermarket', 'food shopping'],
  Transport: ['transport', 'transportation', 'gas', 'fuel', 'petrol', 'commute', 'commuting', 'uber', 'lyft', 'transit', 'parking', 'bart', 'rideshare'],
  Housing: ['housing', 'rent', 'mortgage', 'apartment'],
  Utilities: ['utilities', 'utility', 'electric', 'electricity', 'power bill', 'water bill', 'internet', 'wifi', 'phone bill'],
  Entertainment: ['entertainment', 'movies', 'movie', 'gaming', 'concerts', 'concert'],
  Shopping: ['shopping', 'clothes', 'clothing', 'retail', 'amazon'],
  Health: ['health', 'medical', 'pharmacy', 'doctor', 'dentist', 'healthcare'],
  Travel: ['travel', 'flights', 'flight', 'hotel', 'hotels', 'trip', 'vacation', 'airbnb'],
  Subscriptions: ['subscription', 'subscriptions', 'streaming', 'memberships', 'membership', 'netflix', 'spotify'],
  Education: ['education', 'courses', 'course', 'tuition', 'learning'],
};

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Brand names that appear in CAT_SYNONYMS but should stay as free search terms
// (so "transactions with doordash" retrieves DoorDash rows, not all of Dining).
const BRANDS = new Set(['doordash', 'uber eats', 'ubereats', 'uber', 'lyft', 'bart', 'amazon', 'netflix', 'spotify']);

// English stopwords that carry no signal for transaction retrieval.
const STOPWORDS = new Set(
  ('a an and the of to in on at for is are was were be been do did does done how much many i my me we us our you your what which who when where why whom show tell give list find search see look lookup want need please can could would should every each all any some both few more most than less over under above below about into with from between range around exactly least most as it its them their this that these those here there then than now last previous next current recent spend spent spending cost costs paid pay pays paying charge charges charged buy buys buying bought get gets got purchase purchases purchased transaction transactions txn amount amounts total totals month months year years day days week weeks dollar dollars buck bucks usd rupee rupees inr rs cash money'
  ).split(/\s+/)
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9$.]+/g, ' ')
    .split(' ')
    .filter((t) => t && t.length >= 2 && t.length <= 24);
}

module.exports = { CAT_SYNONYMS, MONTH_NAMES, BRANDS, STOPWORDS, tokenize };
