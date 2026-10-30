// Talks to the Python model API running on the same server.
const API_URL = `http://${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || '5055'}`;

async function call(pathname, options = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL + pathname, { ...options, signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const analyze = (text) => call('/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
});

const health = () => call('/health', {}, 5000);

module.exports = { analyze, health, API_URL };
