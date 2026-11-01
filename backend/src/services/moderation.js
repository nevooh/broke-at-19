// Keeps the public wall clean. Extend the lists as you see what people try.

// Matched anywhere in the text (letters only, after un-leeting), so keep these long enough to avoid false hits.
const STRONG = ['fuck', 'shit', 'bitch', 'porn', 'rape', 'nazi', 'cunt'];
// Matched only as whole words.
const WORDS = ['sex', 'xxx', 'nude', 'nudes', 'scam', 'casino', 'loan', 'loans', 'forex', 'crypto', 'betting', 'onlyfans'];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalize(text) {
  return text.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] || c);
}

function isBlocked(text) {
  const norm = normalize(text);
  const squashed = norm.replace(/[^a-z]/g, '');
  if (STRONG.some((w) => squashed.includes(w))) return true;
  const tokens = norm.split(/[^a-z]+/).filter(Boolean);
  return tokens.some((t) => WORDS.includes(t));
}

const URLISH = /(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ke|me|xyz|app|link|ly|info|biz|site|online|shop)\b)/i;

// Returns { ok: true, value } (value may be null for "not given") or { ok: false, error }.
function cleanName(raw) {
  if (raw == null) return { ok: true, value: null };
  let s = String(raw).normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f\u2060\uFEFF]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return { ok: true, value: null };
  if (s.length > 40) return { ok: false, error: 'Keep your name under 40 characters.' };
  if (!/^[\p{L}\p{M}\p{N} .,'_&-]+$/u.test(s)) {
    return { ok: false, error: 'Names can use letters, numbers and basic punctuation only.' };
  }
  if (URLISH.test(s) || /\d{7,}/.test(s.replace(/[ .-]/g, ''))) {
    return { ok: false, error: 'No links or phone numbers in your name.' };
  }
  if (isBlocked(s)) return { ok: false, error: 'Please pick a different name.' };
  return { ok: true, value: s };
}

function cleanHandle(raw) {
  if (raw == null) return { ok: true, value: null };
  const s = String(raw).trim().replace(/^@/, '');
  if (!s) return { ok: true, value: null };
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s) || s.includes('..')) {
    return { ok: false, error: 'Instagram handle only: letters, numbers, dots and underscores. No links.' };
  }
  if (isBlocked(s)) return { ok: false, error: 'Please use a different handle.' };
  return { ok: true, value: s };
}

module.exports = { cleanName, cleanHandle, isBlocked };