// Sach Check WhatsApp bot.
//
// Flow: allowed person sends news -> we send it to the Python model API ->
// we reply with (1) the chart image + model verdict and (2) Claude's casual take.
//
// Staying connected:
//   - LocalAuth saves the login, so restarts do not need a new QR scan.
//   - takeoverOnConflict: if WhatsApp Web is opened somewhere else, we take the session back.
//   - A watchdog checks the connection every minute. If it is broken, the process
//     exits and pm2 starts it again with a fresh browser (the login is kept).
//   - pm2 also restarts it once a night to keep memory low.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const allow = require('./src/allowlist');
const commands = require('./src/commands');
const api = require('./src/api');
const log = require('./src/log');

// ---------- settings ----------
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const QR_FILE = path.join(__dirname, 'qr.png');
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '').split(',').map(n => allow.normalizeNumber(n)).filter(Boolean);
const MIN_WORDS_TO_CHECK = parseInt(process.env.MIN_WORDS_TO_CHECK || '12', 10);
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_SECONDS || '5', 10) * 1000;
const MAX_AGE_SEC = parseInt(process.env.MAX_MESSAGE_AGE_MINUTES || '10', 10) * 60;
const WATCHDOG_MS = 60 * 1000;
const DEBUG = (process.env.DEBUG_MESSAGES || '1') === '1';
const JOIN_CODE = (process.env.JOIN_CODE || '').trim();
const ADMIN_CODE = (process.env.ADMIN_CODE || '').trim();
const STARTED_AT = Date.now();

const URL_RE = /(https?:\/\/\S+|www\.\S+)/i;
const BOT_PREFIXES = ['🧪', '🤖', '✅', '🗑️', '👥', '⏸️', '▶️', '📊', 'pong'];
const CHECK_WORDS = /^(check|چیک|sach check|سچ چیک)\b[:\s]*/i;

allow.load();
// Numbers allowed straight from .env (ALLOWED_NUMBERS=0300...,0311...), no command needed.
for (const raw of (process.env.ALLOWED_NUMBERS || '').split(',')) {
  const n = allow.normalizeNumber(raw);
  if (n) allow.add({ number: n, chatId: `${n}@c.us` });
}

// ---------- WhatsApp client ----------
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'sach-check', dataPath: AUTH_DIR }),
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-first-run', '--no-zygote', '--disable-extensions',
    ],
  },
});

let ready = false;
let myWid = null;      // our own chat id, e.g. 923001234567@c.us
let myLid = null;      // our own hidden id, e.g. 123456789@lid (newer WhatsApp)
let myNumber = null;

const processed = new Set();       // message ids already handled
const sentByBot = new Set();       // message ids we sent ourselves
const lastCheck = new Map();       // chatId -> time of last check
let queue = Promise.resolve();     // one check at a time, protects the server CPU

function remember(set, id, max = 2000) {
  set.add(id);
  if (set.size > max) set.delete(set.values().next().value);
}

function restart(reason) {
  log.warn(`Restarting bot: ${reason}`);
  ready = false;
  client.destroy().catch(() => {}).finally(() => process.exit(1));   // pm2 starts us again
  setTimeout(() => process.exit(1), 15000).unref();                   // in case destroy hangs
}

client.on('qr', async (qr) => {
  log.info('Scan this QR code with WhatsApp > Linked devices > Link a device:');
  qrcodeTerminal.generate(qr, { small: true });
  try {
    await QRCode.toFile(QR_FILE, qr, { width: 400 });
    log.info(`QR also saved as ${QR_FILE}`);
  } catch { /* terminal QR is enough */ }
});

client.on('authenticated', () => log.info('Logged in (session saved).'));
client.on('auth_failure', (m) => { log.error('Login failed:', m); restart('auth failure'); });

client.on('ready', async () => {
  ready = true;
  myWid = client.info?.wid?._serialized || null;
  myNumber = client.info?.wid?.user || null;
  try {
    if (typeof client.getContactLidAndPhone === 'function' && myWid) {
      const [me] = await client.getContactLidAndPhone([myWid]);
      myLid = me?.lid || null;
    }
  } catch { /* older library version */ }
  fs.rm(QR_FILE, { force: true }, () => {});
  log.info(`✅ Ready. Connected as ${log.mask(myWid)}. Allowed users: ${allow.list().length}. Paused: ${allow.isPaused()}`);
  try {
    const h = await api.health();
    log.info(`Model API OK at ${api.API_URL} (Claude ${h.llm_configured ? 'on' : 'off'})`);
  } catch {
    log.warn(`Model API not reachable at ${api.API_URL}. Is sach-api running?`);
  }
});

client.on('change_state', (s) => log.info('WhatsApp state:', s));

client.on('disconnected', (reason) => {
  log.warn('Disconnected:', reason);
  if (String(reason).toUpperCase().includes('LOGOUT')) {
    // Logged out from the phone: the saved login is useless, a new QR is needed.
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    log.warn('Session was logged out from the phone. Scan the new QR in the logs.');
  }
  restart(`disconnected (${reason})`);
});

// ---------- watchdog ----------
let strikes = 0;
setInterval(async () => {
  if (!ready) {
    // Not connected 10 minutes after start and no QR waiting -> something is stuck.
    if (Date.now() - STARTED_AT > 10 * 60 * 1000 && !fs.existsSync(QR_FILE)) restart('never became ready');
    return;
  }
  try {
    const state = await Promise.race([
      client.getState(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
    ]);
    if (state === 'CONNECTED') { strikes = 0; return; }
    strikes++;
    log.warn(`Watchdog: state is ${state} (${strikes}/3)`);
  } catch (e) {
    strikes++;
    log.warn(`Watchdog: check failed - ${e.message} (${strikes}/3)`);
  }
  if (strikes >= 3) restart('watchdog: connection lost');
}, WATCHDOG_MS);

// ---------- helpers ----------
const isGroupOrBroadcast = (id = '') =>
  id.endsWith('@g.us') || id.endsWith('@broadcast') || id.endsWith('@newsletter') || id === 'status@broadcast';

let selfChatId = null;   // our own "Message yourself" chat id, learned from the first message there

// The id of the chat a message belongs to (works for old @c.us and new @lid ids).
function chatOf(msg) {
  const r = msg.id?.remote;
  return (typeof r === 'string' ? r : r?._serialized) || (msg.fromMe ? msg.to : msg.from);
}

function isSelfChat(msg) {
  if (!msg.fromMe) return false;
  const to = msg.to || '', from = msg.from || '';
  const user = (id) => String(id).split('@')[0];
  const self = to === myWid || (myLid && to === myLid) || user(to) === myNumber
    || (myLid && user(to) === user(myLid)) || (selfChatId && chatOf(msg) === selfChatId)
    || user(to) === user(from);
  if (self && !selfChatId) {
    selfChatId = chatOf(msg);
    log.info(`Own "Message yourself" chat is ${log.mask(selfChatId)}`);
  }
  return self;
}

// Never let a slow WhatsApp lookup block a reply.
const withTimeout = (p, ms = 3000) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);

async function resolveIdentity(msg) {
  const chatId = chatOf(msg);
  const user = (v) => (v ? String(v._serialized || v).split('@')[0] : null);
  let number = chatId.endsWith('@c.us') ? user(chatId) : null;

  // Newer WhatsApp hides numbers behind "@lid" ids. Try every way to get the real number.
  if (!number) {
    const pn = msg._data?.senderPn || msg._data?.participantPn || msg._data?.from?.pn;
    if (pn) number = user(pn);
  }
  if (!number && typeof client.getContactLidAndPhone === 'function') {
    try {
      const res = await withTimeout(client.getContactLidAndPhone([chatId]));
      const r = Array.isArray(res) ? res[0] : null;
      if (r?.pn) number = user(r.pn);
    } catch { /* not available */ }
  }
  if (!number && !msg.fromMe) {
    try {
      const c = await withTimeout(msg.getContact());
      if (c?.id?.server === 'c.us') number = c.id.user;
      else if (c?.number && c.number !== user(chatId)) number = c.number;
    } catch { /* ignore */ }
  }
  if (DEBUG) log.info(`  identity: chat ${log.mask(chatId)} -> number ${number ? log.mask(number) : 'unknown'}`);
  return { chatId, number };
}

function urduWordCount(text) {
  return (text.match(/[؀-ۿ]+/g) || []).length;
}

function looksLikeNews(msg, text) {
  return msg.isForwarded || URL_RE.test(text) || CHECK_WORDS.test(text) || urduWordCount(text) >= MIN_WORDS_TO_CHECK;
}

async function send(chatId, content, options = {}) {
  let sent;
  try {
    sent = await client.sendMessage(chatId, content, options);
  } catch (e) {
    log.warn(`Send to ${log.mask(chatId)} failed: ${e.message}`);
    if (!options.quotedMessageId) throw e;
    const { quotedMessageId, ...rest } = options;            // retry once without the quote
    sent = await client.sendMessage(chatId, content, rest);
  }
  if (sent?.id?._serialized) remember(sentByBot, sent.id._serialized);
  return sent;
}

// Run one news check and send the two replies.
function runCheck(chatId, text, quoted) {
  queue = queue.then(async () => {
    try {
      const chat = await client.getChatById(chatId).catch(() => null);
      chat?.sendStateTyping().catch(() => {});
      const r = await api.analyze(text.replace(CHECK_WORDS, ''));
      const quote = quoted ? { quotedMessageId: quoted.id._serialized } : {};

      if (r.status === 'ok') {
        const media = new MessageMedia('image/png', r.chart_png, 'sach-check.png');
        await send(chatId, media, { caption: r.model_message, ...quote });   // 1) model verdict
        await send(chatId, r.llm_message);                                   // 2) Claude's take
        log.info(`Checked for ${log.mask(chatId)}: ${r.verdict} (${Math.round(r.fake_score * 100)}% fake, ${r.source})`);
      } else {
        await send(chatId, r.message || '🧪 Sach Check: something went wrong.', quote);
        log.info(`Check for ${log.mask(chatId)}: ${r.status}`);
      }
      chat?.clearState().catch(() => {});
    } catch (e) {
      log.error('Check failed:', e.message);
      await send(chatId, '🧪 *Sach Check*\n\nمعذرت، ابھی کچھ تکنیکی مسئلہ ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔').catch(() => {});
    }
  });
  return queue;
}

// ---------- messages ----------
async function onMessage(msg, source) {
  if (DEBUG) {
    const b = (msg.body || '').trim();
    log.info(`[${source}] fromMe=${msg.fromMe} type=${msg.type} from=${log.mask(msg.from)} to=${log.mask(msg.to)} ` +
      `chat=${log.mask(chatOf(msg))} fwd=${Boolean(msg.isForwarded)} ${b.startsWith('!') ? 'cmd=' + b.slice(0, 20) : 'len=' + b.length}`);
  }
  try {
    const id = msg.id?._serialized;
    if (!id || processed.has(id) || sentByBot.has(id)) return;
    remember(processed, id);

    const chatId = chatOf(msg);
    if (!chatId || isGroupOrBroadcast(chatId) || msg.isStatus) return;     // never groups or status
    if (msg.timestamp && Date.now() / 1000 - msg.timestamp > MAX_AGE_SEC) return;  // old backlog

    const text = (msg.body || '').trim();
    if (!text) return;                                                      // images without text, voice notes...

    // ----- messages written from this phone (the owner) -----
    if (msg.fromMe) {
      if (BOT_PREFIXES.some(p => text.startsWith(p))) return;              // our own replies
      const self = isSelfChat(msg);
      const here = chatOf(msg);
      if (text.startsWith('!')) {
        const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
        log.info(`Owner command: !${cmd} (${self ? 'own chat' : 'in chat ' + log.mask(here)})`);
        const target = self ? null : { ...(await resolveIdentity(msg)), chatId: here };
        // Answers go to "Message yourself". If we don't know that chat yet, answer right here.
        const respond = async (t) => {
          const dest = self ? here : (selfChatId || myWid);
          try { return await send(dest, t); } catch { return send(here, t); }
        };
        return commands.handle(cmd.toLowerCase(), {
          args, isSelfChat: self,
          targetChatId: target?.chatId, targetNumber: target?.number,
          respond, runCheck: (t) => runCheck(self ? here : (selfChatId || here), t),
          getState: () => client.getState(), startedAt: STARTED_AT,
        });
      }
      if (self && looksLikeNews(msg, text)) return runCheck(here, text, msg);  // owner testing in own chat
      return;                                                               // owner chatting normally
    }

    // ----- messages from other people -----
    const who = await resolveIdentity(msg);

    // "join <code>": works even when WhatsApp hides the number behind an @lid id.
    const join = text.match(/^!?join\s+(\S+)$/i);
    if (join) {
      const code = join[1];
      if (ADMIN_CODE && code === ADMIN_CODE) {
        allow.add({ number: who.number, chatId, admin: true });
        log.info(`Admin joined: ${log.mask(chatId)}`);
        return send(chatId, '✅ *Sach Check*\n\nYou are now an admin. Send *!help* to see commands.');
      }
      if (JOIN_CODE && code === JOIN_CODE) {
        allow.add({ number: who.number, chatId });
        log.info(`User joined: ${log.mask(chatId)}`);
        return send(chatId, '✅ *Sach Check*\n\nخوش آمدید! اب کوئی بھی اردو خبر یا خبر کا لنک یہاں فارورڈ کریں، میں بتاؤں گا کہ یہ جعلی لگتی ہے یا نہیں۔\n_Welcome! Forward any Urdu news or news link here to check it._');
      }
      return;                                                               // wrong code: stay silent
    }

    const isAdmin = Boolean((who.number && ADMIN_NUMBERS.includes(who.number)) || allow.isAdmin(who));

    if (isAdmin && text.startsWith('!')) {
      const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
      return commands.handle(cmd.toLowerCase(), {
        args, isSelfChat: true, respond: (t) => send(chatId, t),
        runCheck: (t) => runCheck(chatId, t), getState: () => client.getState(), startedAt: STARTED_AT,
      });
    }

    if (allow.isPaused()) return;
    if (!isAdmin && !allow.isAllowed(who)) return;                          // not on the list: stay silent

    if (/^(!?help|menu|مدد)$/i.test(text)) {
      return send(chatId, '🧪 *Sach Check*\n\nکوئی بھی اردو خبر یا خبر کا لنک یہاں فارورڈ کریں، میں بتاؤں گا کہ یہ جعلی لگتی ہے یا نہیں۔\n_Forward any Urdu news or news link here to check it._');
    }
    if (!looksLikeNews(msg, text)) return;                                  // normal chat, not news

    const last = lastCheck.get(chatId) || 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    lastCheck.set(chatId, Date.now());

    await runCheck(chatId, text, msg);
  } catch (e) {
    log.error('Message handler error:', e.message);
  }
}

// Both events, because some WhatsApp versions only fire one of them.
// The "processed" set makes sure each message is handled once.
client.on('message_create', (msg) => onMessage(msg, 'create'));
client.on('message', (msg) => onMessage(msg, 'in'));

// ---------- start / stop ----------
process.on('unhandledRejection', (e) => {
  const m = String(e?.message || e);
  log.error('Unhandled:', m);
  if (ready && /Session closed|Target closed|Protocol error|Execution context was destroyed|detached Frame/i.test(m)) {
    restart('browser crashed');
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    log.info(`${sig} received, closing WhatsApp cleanly...`);
    await client.destroy().catch(() => {});
    process.exit(0);
  });
}

log.info('Starting Sach Check bot...');
log.info(`Admins from .env: ${ADMIN_NUMBERS.length}. Allowed users: ${allow.list().length}`);
client.initialize().catch((e) => { log.error('Start failed:', e.message); restart('initialize failed'); });
