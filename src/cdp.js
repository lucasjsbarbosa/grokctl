// Minimal Chrome DevTools Protocol client for the Grok Bot renderer.
// Run it with Windows node: the debug port listens on 127.0.0.1 of the Windows host only.
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.GROKCTL_PORT || 9333;

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', () => reject(new Error(`Grok Bot debug port ${PORT} not reachable. Is Grok Bot running with --remote-debugging-port=${PORT}?`)));
  });
}

async function connect() {
  const targets = await getJSON('/json/list');
  const page = targets.find(t => t.type === 'page' && t.url.includes('renderer/index.html')) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('No Grok Bot page target found');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const pending = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

module.exports = { connect };

if (require.main === module) {
  (async () => {
    const c = await connect();
    const v = await c.evaluate(process.argv[2]);
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    c.close();
  })().catch(e => { console.error('grokctl:', e.message); process.exit(1); });
}
