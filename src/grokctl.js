#!/usr/bin/env node
// grokctl — drive the Grok Bot desktop app over the Chrome DevTools Protocol.
//   grokctl bots                     list bots (* = active)
//   grokctl use <name>               switch to a bot
//   grokctl ask [--bot <name>] [--no-wait] [--timeout <s>] <message>
//   grokctl read [n]                 last n transcript messages (default 5)
//   grokctl state                    busy/idle of the active bot
//   grokctl eval <js>                raw JS in the renderer (debugging)
const { connect } = require('./cdp');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const JS = {
  bots: `[...document.querySelectorAll("button[data-agent-id]")].map(b => ({
    id: b.dataset.agentId, active: b.dataset.active === "true",
    name: (b.getAttribute("aria-label") || b.innerText).split(",")[0].trim() }))`,
  messages: `[...document.querySelectorAll(".sand-message[data-role]")].map(m => ({
    role: m.dataset.role, text: m.innerText.trim() }))`,
  busy: `(() => {
    const states = [...document.querySelectorAll("[data-grok-state]")].map(e => e.dataset.grokState);
    const stop = [...document.querySelectorAll("button")].some(b => /^(Stop|Parar|Interromper|Detener)/i.test(b.getAttribute("aria-label") || ""));
    return stop || states.some(s => s && !["idle", "finished"].includes(s));
  })()`,
};

async function bots(c) { return c.evaluate(JS.bots); }

async function useBot(c, name) {
  const list = await bots(c);
  const want = name.toLowerCase();
  const bot = list.find(b => b.name.toLowerCase() === want) || list.find(b => b.name.toLowerCase().includes(want));
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

async function waitReply(c, beforeCount, timeoutS) {
  const deadline = Date.now() + timeoutS * 1000;
  let last = '', stableSince = 0;
  while (Date.now() < deadline) {
    await sleep(1500);
    const msgs = await messages(c);
    const fresh = msgs.slice(beforeCount).filter(m => m.role !== 'user');
    const busy = await c.evaluate(JS.busy);
    const snapshot = JSON.stringify(fresh);
    if (snapshot !== last) { last = snapshot; stableSince = Date.now(); }
    // done when there is a reply, the bot is idle, and the transcript stopped changing for 4s
    if (fresh.length && !busy && Date.now() - stableSince > 4000) return fresh;
  }
  const msgs = await messages(c);
  return { timeout: true, partial: msgs.slice(beforeCount).filter(m => m.role !== 'user') };
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
        for (const b of await bots(c)) console.log(`${b.active ? '*' : ' '} ${b.name}`);
        break;
      case 'use':
        console.log(`active: ${(await useBot(c, rest.join(' '))).name}`);
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
        const before = (await messages(c)).length;
        await send(c, text);
        if (!opt.wait) { console.log('sent'); break; }
        const r = await waitReply(c, before, opt.timeout);
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
        console.log('usage: grokctl bots | use <name> | ask [--bot name] [--no-wait] [--timeout s] <msg> | read [n] | state | eval <js>');
    }
  } finally {
    c.close();
  }
}

main().catch(e => { console.error('grokctl:', e.message); process.exit(1); });
