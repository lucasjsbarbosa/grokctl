# grokctl: control the Grok Bot desktop app from the terminal

**Grok Bot CLI** for Claude Code, Codex, OpenCode and Maestri multi-agent teams. *Português abaixo.*

**Unofficial** command-line bridge to the **Grok Bot** desktop app. It lets terminal agents (Claude Code, Codex, OpenCode, …) and orchestrators such as Maestri send tasks to your Grok bots and read their answers.

Grok bots run on their own cloud machines, so a team of bots costs your PC almost no RAM: only the Grok Bot app itself stays open locally.

> [!WARNING]
> This is not affiliated with or endorsed by xAI or the makers of Grok Bot. It works by driving the app's UI through the Chrome DevTools Protocol, so **an app update can break it at any time**. Automating the app may be restricted by its terms of service. Read them and use it at your own risk.

## How it works

Grok Bot is an Electron app with no CLI or public API. `grokctl` restarts it with Chromium's DevTools port bound to `127.0.0.1`, then types into the composer, clicks **Send**, and reads the transcript from the page.

```
your agent ──► grokctl ──► 127.0.0.1:9333 (DevTools) ──► Grok Bot app ──► Grok bot (cloud)
```

## Requirements

- Windows with the Grok Bot desktop app installed and signed in
- Node.js 18+ on Windows
- Optional: WSL, for using `grokctl` from Linux terminals

## Install

Clone it **on the Windows filesystem** (for example `C:\Users\<you>\grokctl`), even if you will use it from WSL:

```powershell
git clone https://github.com/lucasjsbarbosa/grokctl.git
cd grokctl
npm install
```

Start Grok Bot with the DevTools port enabled. This closes Grok Bot if it is open, so let running tasks finish first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-grok-bot.ps1
```

Put the launcher on your PATH:

- **Windows:** add the `bin` folder to `PATH` (uses `bin\grokctl.cmd`).
- **WSL:** `ln -s /mnt/c/Users/<you>/grokctl/bin/grokctl ~/.local/bin/grokctl`. The script calls Windows `node.exe` because the port only listens on the Windows host.

If you open Grok Bot normally (Start menu or desktop shortcut), the port is not enabled. Run `start-grok-bot.ps1` again.

## Usage

```bash
grokctl bots                              # list bots (* = active)
grokctl use "Research"                    # switch the active bot
grokctl create "Research"                 # create a new bot
grokctl ask "Summarize today's HN front page"          # send and wait for the reply
grokctl ask --bot "Research" --timeout 900 "..."       # target a bot, wait up to 15 min
grokctl ask --bot "Research" --no-wait "..."           # fire and forget
grokctl ask --bot "Research" --file notes.txt "Summarize this"   # long input from a file
grokctl state                             # busy | idle
grokctl read 5                            # last 5 transcript messages
grokctl eval 'document.title'             # raw JS in the app (debugging)
```

`ask` exits with code `2` on timeout; the bot keeps working, so check back with `grokctl read`.

`ask` finds the reply by anchoring on the message it just sent, so it keeps working when the transcript only renders the last few messages and while the Grok Bot window is minimized.

If Node is not on the Windows `PATH` (for example a portable install), point the WSL launcher at it with `GROKCTL_NODE=/mnt/c/Users/<you>/tools/node/node.exe`.

Windows caps a command line at about 32,000 characters, so pass long inputs with `--file`. From WSL, give the file as a Windows path (`wslpath -w file.txt`) or keep it under the repo folder.

Set `GROKCTL_PORT` to use a port other than `9333`, and pass the same `-Port` to `start-grok-bot.ps1`.

## Using it with Maestri

Any Maestri terminal can call `grokctl`, so a Maestro (or a dedicated recruit) can hand work to Grok bots alongside its other teammates. See [`examples/maestri-role.md`](examples/maestri-role.md).

## Building a team of bots

A pattern that works well: one coordinator bot plus specialists plus a separate checker.

```bash
grokctl create "Chief of Staff"   # routes tasks, keeps a status Page, consolidates results
grokctl create "Research"         # web + X research
grokctl create "Writer"           # drafts only, a human or another agent publishes
grokctl create "Verifier"         # checks links, numbers and rules in the others' output

# give each bot its role once; it stays in the bot's memory
grokctl ask --bot "Research" "Your role: ... Save this role to your permanent memory and reply 'ready'."

# chain them: research, then verify
grokctl ask --bot "Research" --timeout 900 "Find ..." > research.txt
grokctl ask --bot "Verifier" --timeout 900 "Check this list: $(cat research.txt)"
```

Tips:
- Bots cannot see your terminal or files. Put all the context the task needs in the message.
- Keep secrets (keys, seeds, passwords) out of messages. Use the app's own Vault if a bot truly needs a login.
- Long tasks: `ask --no-wait`, then poll `grokctl state` and fetch the answer with `grokctl read`.

## Security

While the DevTools port is open, **any program running on your PC can fully control Grok Bot**, including the apps you connected to it (email, calendar, …). It only listens on `127.0.0.1`, so other machines cannot reach it. Restart Grok Bot normally when you don't need `grokctl`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `debug port 9333 not reachable` | Grok Bot was opened without the flag. Run `scripts\start-grok-bot.ps1`. |
| `send button not found` | The UI changed. Open an issue with your Grok Bot version. |
| `node.exe: not found` from WSL | Install Node on Windows, or set `GROKCTL_NODE` to the full path of `node.exe`. |
| `UtilAcceptVsock ... accept4 failed` from WSL | WSL interop is stuck in that shell. Open a new terminal or run `wsl --shutdown` from Windows. |
| `ask` always times out | Check `grokctl state`. If it stays `busy`, the state selectors in `src/grokctl.js` need updating. |

Tested with Grok Bot 0.75.8 (Electron 42) on Windows 11, natively and from WSL2.

## FAQ

**Does Grok Bot have a CLI or API?**
Not officially, as of Grok Bot 0.75.8. `grokctl` fills that gap by driving the app over the Chrome DevTools Protocol.

**Can Claude Code (or Codex, OpenCode, Gemini CLI) send tasks to Grok Bot?**
Yes. Any agent that can run a shell command can call `grokctl ask "..."` and read the reply from stdout.

**Can I use Grok Bot inside Maestri?**
Grok Bot can't be recruited as a Maestri terminal agent, and the `maestri` CLI only works inside Maestri terminals. Instead, a Maestri agent calls `grokctl` to delegate to your Grok bots. See [`examples/maestri-role.md`](examples/maestri-role.md).

**Why use Grok bots for a multi-agent team?**
Each Grok bot works on its own cloud computer. Running several local CLI agents can use hundreds of MB of RAM each; Grok bots only need the one Grok Bot window open.

**Does it work on macOS or Linux?**
It is tested only on Windows (natively and from WSL2). The approach should work wherever Grok Bot runs, but the start script is PowerShell-only. Pull requests are welcome.

## Português

**grokctl** é uma CLI não oficial para controlar o app **Grok Bot** pelo terminal. Com ela, agentes como Claude Code, Codex e OpenCode, ou um time de agentes no **Maestri**, mandam tarefas para os seus bots do Grok e leem as respostas. Os bots rodam na nuvem, então um time inteiro quase não gasta RAM do seu PC.

1. Clone no disco do Windows e rode `npm install`.
2. Abra o Grok Bot com a porta de depuração: `powershell -ExecutionPolicy Bypass -File scripts\start-grok-bot.ps1`. Depois de reiniciar o PC, rode de novo.
3. Use: `grokctl bots`, `grokctl create "Nome"`, `grokctl ask --bot "Nome" "tarefa"`, `grokctl read`.
4. No WSL, se o Node não estiver no PATH do Windows (instalação portátil), use `GROKCTL_NODE=/mnt/c/Users/<voce>/tools/node/node.exe`.

Para montar um time: um bot coordenador (chefe de gabinete), bots especialistas e um bot verificador separado que confere a entrega dos outros. Veja a seção **Building a team of bots** acima.

Atenção: o projeto não é oficial, pode quebrar quando o app atualizar, e enquanto a porta estiver aberta qualquer programa do PC consegue controlar o Grok Bot. Leia a seção **Security** acima.

## License

MIT
