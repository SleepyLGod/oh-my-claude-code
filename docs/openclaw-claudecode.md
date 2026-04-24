# OpenClaw × Claude Code

This setup has two separate paths.

## 1. Telegram remote control

This path is controlled by `/remote-openclaw`.

- Dedicated Telegram bot
- Dedicated OpenClaw gateway project: `~/Projects/openclaw-claudecode`
- Dedicated `/claude` command surface
- Dedicated registered Claude Code target session
- Fork config home: `~/.von-claude`

Flow:

1. Start in a normal local Claude Code session `A`
2. Run `/remote-openclaw register`
3. Claude Code registers the current session for remote control
4. In Telegram, run `/claude sessions`
5. In Telegram, run `/claude attach <session-id>`
6. Ordinary Telegram text continues the attached Claude Code session

Important:

- Telegram does not create its own Claude session
- Telegram does not resume arbitrary history in v1
- Telegram can only attach sessions that were explicitly registered locally
- The dedicated gateway can stay running all the time
- If `/remote-openclaw` is inactive, Telegram only returns a fixed hint
- Registering a session does not lock the local REPL by itself
- Once Telegram attaches, that local session only allows:
  - `/remote-openclaw status`
  - `/remote-openclaw unregister`
  - `/status`
  - `/new`
  - `/branch` or `/fork`
  - `/resume <other-session>`
  - `/exit`
- Other local text and commands are rejected with a hint to stop or switch away

## 2. Main OpenClaw task agent

This path is independent from `/remote-openclaw`.

- Main OpenClaw bot stays on its current default model and behavior
- Extra ACP agent: `claude-code`
- Used only when main OpenClaw explicitly dispatches work to Claude Code

Important:

- This does not attach to the Telegram-controlled session
- This does not read `/remote-openclaw` state
- This should run in its own Claude Code session lifecycle
- It should not affect your current local Claude Code conversation
- Official Claude Code should be added as a separate OpenClaw agent, not as a replacement for this fork agent

## Minimal Telegram remote-control smoke test

1. In local Claude Code, run `/remote-openclaw register`
2. Start the dedicated gateway:

```bash
~/Projects/openclaw-claudecode/tools/run_openclaw_claudecode_gateway.sh
```

3. In Telegram, run `/claude sessions`
4. Attach the registered session with `/claude attach <session-id>`
5. Send a normal Telegram message
6. Confirm the reply lands in the attached Claude Code session
7. Back in local Claude Code, try normal input and confirm it is blocked while attached
8. In Telegram, run `/claude detach`
9. Confirm the local Claude Code session becomes writable again
10. Run `/remote-openclaw unregister`, then confirm Telegram falls back to the inactive hint

## Minimal main-agent smoke test

This is separate from the Telegram remote-control test.

1. Keep your main OpenClaw gateway on the current DeepSeek default path
2. Explicitly route one task to `claude-code`
3. Confirm the task runs through Claude Code
4. Confirm it does not touch the Telegram-controlled registered session
