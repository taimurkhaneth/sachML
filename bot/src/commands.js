// Owner commands. The owner types these in their own "Message yourself" chat,
// or inside a person's chat (then that person is the target).
//
//   !help                    show this list
//   !add 03001234567 Ali     allow a number (name is optional)
//   !add Ali                 (typed inside a person's chat) allow that person
//   !remove 03001234567      remove a number
//   !remove                  (typed inside a person's chat) remove that person
//   !list                    show everyone allowed
//   !pause / !resume         stop / start replying to everyone
//   !status                  connection, model API and Claude status
//   !check <news text>       test the bot yourself

const allow = require('./allowlist');
const api = require('./api');
const { mask } = require('./log');

const HELP = [
  '🧪 *Sach Check · Owner commands*',
  '',
  '*!add 03001234567 Ali* – allow a number',
  '*!add Ali* – typed inside someone\'s chat, allows that person',
  '*!remove 03001234567* – remove a number',
  '*!remove* – typed inside someone\'s chat, removes that person',
  '*!list* – everyone who is allowed',
  '*!pause* / *!resume* – stop / start all replies',
  '*!status* – check that everything is running',
  '*!check <news>* – test a news text yourself',
  '',
  'Tip: forward any news to your own "Message yourself" chat to test it.',
].join('\n');

// "+92 300 1234567 Ali" -> { number: '923001234567', rest: ['Ali'] }
function splitNumber(args) {
  let i = 0;
  while (i < args.length && /^[+\d()-]+$/.test(args[i])) i++;
  const raw = args.slice(0, i).join('');
  const number = /\d{6,}/.test(raw.replace(/\D/g, '')) ? allow.normalizeNumber(raw) : null;
  return { number, rest: args.slice(i) };
}

function displayUser(u) {
  const who = u.number ? '+' + u.number : (u.chatIds[0] ? mask(u.chatIds[0]) : '?');
  return `• ${u.name ? u.name + ' – ' : ''}${who}`;
}

// ctx: { msg, args, isSelfChat, targetChatId, respond(text), runCheck(text), getState(), startedAt }
async function handle(command, ctx) {
  const { args, isSelfChat, targetChatId, respond } = ctx;

  switch (command) {
    case 'help':
    case 'menu':
      return respond(HELP);

    case 'add': {
      const { number: maybeNumber, rest } = splitNumber(args);
      if (maybeNumber) {
        const name = rest.join(' ');
        const { isNew } = allow.add({ number: maybeNumber, chatId: `${maybeNumber}@c.us`, name });
        return respond(`✅ ${isNew ? 'Added' : 'Updated'} +${maybeNumber}${name ? ' (' + name + ')' : ''}. They can now send news to this number.`);
      }
      if (!isSelfChat && targetChatId) {
        const name = args.join(' ');
        const number = targetChatId.endsWith('@c.us') ? targetChatId.split('@')[0] : (ctx.targetNumber || null);
        const { isNew } = allow.add({ number, chatId: targetChatId, name });
        return respond(`✅ ${isNew ? 'Added' : 'Updated'} ${name || (number ? '+' + number : 'this person')}. They can now send news to this number.`);
      }
      return respond('Write it like this: *!add 03001234567 Ali*');
    }

    case 'remove':
    case 'delete': {
      const { number } = splitNumber(args);
      let removed = 0;
      if (number) removed = allow.remove({ number, chatId: `${number}@c.us` });
      else if (!isSelfChat && targetChatId) removed = allow.remove({ chatId: targetChatId, number: ctx.targetNumber });
      else return respond('Write it like this: *!remove 03001234567*');
      return respond(removed ? '🗑️ Removed. They will no longer get replies.' : 'That person was not on the list.');
    }

    case 'list': {
      const users = allow.list();
      if (!users.length) return respond('Nobody is allowed yet. Add someone with *!add 03001234567 Name*');
      return respond(`👥 *Allowed users (${users.length})*\n\n` + users.map(displayUser).join('\n'));
    }

    case 'pause':
      allow.setPaused(true);
      return respond('⏸️ Paused. The bot will not reply to anyone until you send *!resume*.');

    case 'resume':
      allow.setPaused(false);
      return respond('▶️ Resumed. The bot is replying again.');

    case 'status': {
      let apiLine = '❌ Model API not reachable';
      try {
        const h = await api.health();
        apiLine = `✅ Model API running (model ${h.model_loaded ? 'loaded' : 'not loaded'})\n` +
                  `${h.llm_configured ? '✅' : '⚠️'} Claude: ${h.llm_configured ? h.claude_model : 'no API key, using ready-made replies'}`;
      } catch { /* keep the error line */ }
      const state = await ctx.getState().catch(() => 'unknown');
      const mins = Math.round((Date.now() - ctx.startedAt) / 60000);
      return respond([
        '📊 *Sach Check status*', '',
        `WhatsApp: ${state}`,
        apiLine,
        `Allowed users: ${allow.list().length}`,
        `Replies: ${allow.isPaused() ? 'PAUSED' : 'on'}`,
        `Uptime: ${mins} min`,
      ].join('\n'));
    }

    case 'check': {
      const text = args.join(' ').trim();
      if (!text) return respond('Write it like this: *!check <news text>*');
      return ctx.runCheck(text);
    }

    case 'ping':
      return respond('pong 🏓');

    default:
      return respond('Unknown command. Send *!help* to see all commands.');
  }
}

module.exports = { handle, HELP };
