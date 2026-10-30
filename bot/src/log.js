// Small logger. Phone numbers are masked so logs never show full numbers.
const mask = (id) => {
  const s = String(id || '');
  const digits = s.split('@')[0];
  return digits.length > 4 ? '…' + digits.slice(-4) + (s.includes('@') ? '@' + s.split('@')[1] : '') : s;
};

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const info = (...a) => console.log(stamp(), '[info]', ...a);
const warn = (...a) => console.warn(stamp(), '[warn]', ...a);
const error = (...a) => console.error(stamp(), '[error]', ...a);

module.exports = { info, warn, error, mask };
