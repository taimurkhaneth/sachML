// Who is allowed to use the bot. Stored in bot/data/allowed.json (not in git).
//
// A person can be matched two ways:
//   - by phone number (e.g. 923001234567)
//   - by WhatsApp chat id (e.g. 923001234567@c.us, or a hidden "@lid" id that
//     newer WhatsApp versions use instead of the phone number)
// Once a person is matched by number, their chat id is remembered too.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'allowed.json');
let state = { paused: false, users: [] };

function load() {
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state.users = state.users || [];
  } catch {
    save();
  }
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);                       // atomic: never a half-written file
}

// "0300-1234567", "+92 300 1234567", "923001234567" -> "923001234567"
function normalizeNumber(input, countryCode = process.env.DEFAULT_COUNTRY_CODE || '92') {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = countryCode + d.slice(1);
  else if (d.length <= 10) d = countryCode + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

function find({ chatId, number }) {
  return state.users.find(u => (number && u.number === number) || (chatId && (u.chatIds || []).includes(chatId)));
}

function isAllowed(identity) {
  const u = find(identity);
  if (u && identity.chatId && !(u.chatIds || []).includes(identity.chatId)) {
    u.chatIds = [...(u.chatIds || []), identity.chatId];       // remember this chat id
    save();
  }
  return Boolean(u);
}

function add({ number, chatId, name }) {
  let u = find({ number, chatId });
  if (u) {
    if (number && !u.number) u.number = number;
    if (chatId && !(u.chatIds || []).includes(chatId)) u.chatIds = [...(u.chatIds || []), chatId];
    if (name) u.name = name;
    save();
    return { user: u, isNew: false };
  }
  u = { number: number || null, chatIds: chatId ? [chatId] : [], name: name || '', addedAt: new Date().toISOString() };
  state.users.push(u);
  save();
  return { user: u, isNew: true };
}

function remove({ number, chatId }) {
  const before = state.users.length;
  state.users = state.users.filter(u => !((number && u.number === number) || (chatId && (u.chatIds || []).includes(chatId))));
  save();
  return before - state.users.length;
}

const list = () => state.users;
const isPaused = () => Boolean(state.paused);
function setPaused(v) { state.paused = Boolean(v); save(); }

module.exports = { load, normalizeNumber, isAllowed, add, remove, list, isPaused, setPaused };
