#!/usr/bin/env node
// grokctl — drive the Grok Bot desktop app over the Chrome DevTools Protocol.
//   grokctl bots                     list bots (* = active)
//   grokctl use <name>               switch to a bot
//   grokctl create <name>            create a new bot
//   grokctl ask [--bot <name>] [--no-wait] [--timeout <s>] <message>
//   grokctl read [n]                 last n transcript messages (default 5)
//   grokctl state                    busy/idle of the active bot
//   grokctl eval <js>                raw JS in the renderer (debugging)
const { connect } = require('./cdp');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const JS = {
  bots: `[...document.querySelectorAll("button[data-agent-id]")].map(b => ({
    id: b.dataset.agentId, active: b.dataset.active === "true",
    name: (b.getAttribute("aria-label") || b.innerText || b.textContent).split(",")[0].trim() }))`,
  // innerText is empty while the window is minimized, so fall back to textContent
  messages: `[...document.querySelectorAll(".sand-message[data-role]")].map(m => ({
    role: m.dataset.role, text: (m.innerText || m.textContent).trim() }))`,
  busy: `(() => {
    const states = [...document.querySelectorAll("[data-grok-state]")].map(e => e.dataset.grokState);
    const stop = [...document.querySelectorAll("button")].some(b => /^(Stop|Parar|Interromper|Detener)/i.test(b.getAttribute("aria-label") || ""));
    return stop || states.some(s => s && !["idle", "finished"].includes(s));
  })()`,
};

async function bots(c) { return c.evaluate(JS.bots); }

// The sidebar only renders the bots near the visible area, so scroll through it to see them all.
const SCROLL = pos => `(() => { const b = document.querySelector("button[data-agent-id]");
  const v = b && b.closest(".ui-scroll-area__viewport"); if (!v) return false;
  ${pos === 'top' ? 'v.scrollTop = 0' : 'v.scrollTop += v.clientHeight * 0.8'};
  return v.scrollTop + v.clientHeight < v.scrollHeight - 2; })()`;

async function allBots(c) {
  const seen = new Map();
  await c.evaluate(SCROLL('top')); await sleep(300);
  for (let i = 0; i < 50; i++) {
    for (const b of await bots(c)) if (!seen.has(b.id)) seen.set(b.id, b);
    const more = await c.evaluate(SCROLL('down')); await sleep(300);
    if (!more) { for (const b of await bots(c)) if (!seen.has(b.id)) seen.set(b.id, b); break; }
  }
  await c.evaluate(SCROLL('top'));
  return [...seen.values()];
}

async function findBot(c, name) {
  const want = name.toLowerCase();
  const pick = list => list.find(b => b.name.toLowerCase() === want) || list.find(b => b.name.toLowerCase().includes(want));
  let bot = pick(await bots(c));
  if (bot) return { bot };
  await c.evaluate(SCROLL('top')); await sleep(300);
  for (let i = 0; i < 50; i++) {
    bot = pick(await bots(c));
    if (bot) return { bot, scrolled: true };
    const more = await c.evaluate(SCROLL('down')); await sleep(400);
    if (!more) { bot = pick(await bots(c)); if (bot) return { bot, scrolled: true }; break; }
  }
  return { list: await allBots(c) };
}

async function useBot(c, name) {
  const { bot, list } = await findBot(c, name);
  if (!bot) throw new Error(`bot "${name}" not found. Bots: ${list.map(b => b.name).join(', ')}`);
  if (!bot.active) {
    await c.evaluate(`document.querySelector('button[data-agent-id="${bot.id}"]').click()`);
    await sleep(1500);
  }
  return bot;
}

async function messages(c) { return c.evaluate(JS.messages); }

async function send(c, text) {
  const ok = await c.evaluate(`(() => { const f = document.querySelector(".sand-prompt-field"); if (!f) return false; f.focus(); return true; })()`);
  if (!ok) throw new Error('prompt field not found');
  await c.send('Input.insertText', { text });
  await sleep(300);
  // Enter key events don't submit the tiptap composer; click the submit button instead
  const clicked = await c.evaluate(`(() => {
    const f = document.querySelector(".sand-prompt-field");
    const b = (f && f.closest("form") && f.closest("form").querySelector('button[type="submit"]'))
      || document.querySelector('button[type="submit"][aria-label="Send message"], button[type="submit"][aria-label="Enviar mensagem"]');
    if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!clicked) throw new Error('send button not found or disabled');
}

// The transcript is virtualized (only the last few messages are in the DOM), so counting
// messages before/after sending is unreliable. Anchor on our own message instead.
const norm = t => t.replace(/\s+/g, ' ').trim();
function after(msgs, sent) {
  const key = norm(sent).slice(0, 80);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && norm(msgs[i].text).includes(key)) return msgs.slice(i + 1).filter(m => m.role !== 'user');
  }
  return [];
}

async function createBot(c, name) {
  const opened = await c.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => /^(New Bot|Novo Bot)$/i.test(x.getAttribute("aria-label") || ""));
    if (!b) return false; b.click(); return true; })()`);
  if (!opened) throw new Error('"New Bot" button not found');
  await sleep(1500);
  const r = await c.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]'); if (!d) return 'dialog not found';
    const i = d.querySelector('input[placeholder]'); if (!i) return 'name field not found';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(name)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const ok = [...d.querySelectorAll('button')].find(x => /^(Create|Criar)$/i.test(x.textContent.trim()));
    if (!ok || ok.disabled) return 'create button not found or disabled';
    ok.click(); return 'ok'; })()`);
  if (r !== 'ok') throw new Error(r);
  await sleep(1500);
}

async function waitReply(c, sent, timeoutS, bot) {
  const deadline = Date.now() + timeoutS * 1000;
  let last = '', stableSince = 0;
  while (Date.now() < deadline) {
    await sleep(1500);
    // another grokctl process may have switched the active bot meanwhile
    if (bot) await useBot(c, bot);
    const fresh = after(await messages(c), sent);
    const busy = await c.evaluate(JS.busy);
    const snapshot = JSON.stringify(fresh);
    if (snapshot !== last) { last = snapshot; stableSince = Date.now(); }
    // done when there is a reply, the bot is idle, and the transcript stopped changing for 4s
    if (fresh.length && !busy && Date.now() - stableSince > 4000) return fresh;
  }
  return { timeout: true, partial: after(await messages(c), sent) };
}

function fmt(msgs) {
  return msgs.map(m => `[${m.role}] ${m.text}`).join('\n\n');
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  const opt = { wait: true, timeout: 600 };
  const rest = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--bot') opt.bot = args.shift();
    else if (a === '--no-wait') opt.wait = false;
    else if (a === '--timeout') opt.timeout = Number(args.shift());
    else rest.push(a);
  }
  const c = await connect();
  try {
    if (opt.bot) await useBot(c, opt.bot);
    switch (cmd) {
      case 'bots':
        for (const b of await allBots(c)) console.log(`${b.active ? '*' : ' '} ${b.name}`);
        break;
      case 'use':
        console.log(`active: ${(await useBot(c, rest.join(' '))).name}`);
        break;
      case 'create':
        if (!rest.length) throw new Error('usage: grokctl create <name>');
        await createBot(c, rest.join(' '));
        console.log(`created: ${rest.join(' ')}`);
        break;
      case 'state':
        console.log((await c.evaluate(JS.busy)) ? 'busy' : 'idle');
        break;
      case 'read': {
        const n = Number(rest[0] || 5);
        console.log(fmt((await messages(c)).slice(-n)));
        break;
      }
      case 'ask': {
        const text = rest.join(' ');
        if (!text) throw new Error('usage: grokctl ask [--bot name] <message>');
        await send(c, text);
        if (!opt.wait) { console.log('sent'); break; }
        const r = await waitReply(c, text, opt.timeout, opt.bot);
        if (r.timeout) { console.log(`(timeout after ${opt.timeout}s — bot still working; use "grokctl read")\n` + fmt(r.partial)); process.exitCode = 2; }
        else console.log(fmt(r));
        break;
      }
      case 'eval': {
        const v = await c.evaluate(rest.join(' '));
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
        break;
      }
      default:
        console.log('usage: grokctl bots | use <name> | create <name> | ask [--bot name] [--no-wait] [--timeout s] <msg> | read [n] | state | eval <js>');
    }
  } finally {
    c.close();
  }
}

main().catch(e => { console.error('grokctl:', e.message); process.exit(1); });
