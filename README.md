# Pawtropolis Tech Gatekeeper

Runs the community gate process end-to-end: collects applications, equips reviewers, and keeps audit trails clean.

[![Node.js 20](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![discord.js v14](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/#/)
[![License LicenseRef-ANW-1.0](https://img.shields.io/badge/license-LicenseRef--ANW--1.0-0a2f5a)](LICENSE)

## Table of Contents

- [Quick Install](#quick-install)
- [Run Locally](#run-locally)
- [Remote Server (Ops)](#remote-server-ops)
- [How To Use (Staff)](#how-to-use-staff)
- [Troubleshooting (Fast)](#troubleshooting-fast)
- [License](#license)

## Quick Install

### Windows (PowerShell)

```powershell
git clone https://github.com/watchthelight/pawtropolis-tech.git
cd pawtropolis-tech
npm ci
npm run build
```

### macOS/Linux (bash)

```bash
git clone https://github.com/watchthelight/pawtropolis-tech.git
cd pawtropolis-tech
npm ci
npm run build
```

## Run Locally

### Dev (watch)

```bash
npm run dev
```

### Prod (built)

```bash
npm start
```

## Remote Server (Ops)

Start remote:

```powershell
.\start.cmd --remote
```

Stop remote:

```powershell
.\stop.cmd --remote
```

Deploy slash commands to the server:

```bash
npm run deploy:cmds
```

Check which bot/app you're running:

```bash
npm run auth:whoami
```

## How To Use (Staff)

- Run `/gate setup` once per guild to wire review, gate, unverified, and welcome channels plus roles. Adjust later with `/gate config`.
- Applicants press **Start** on the pinned Gate Entry message, fill paged modals, and submit.
- Reviewers handle drafts in the staff channel: approve, reject, request info, kick, or set cooldowns using the buttons that appear.
- `/health` returns uptime and websocket latency for quick diagnostics.
- `/statusupdate text:<message>` refreshes the bot presence string when you need new messaging.
- `/gate factory-reset` wipes application data after a modal confirmation; use only for emergency resets.
- Sentry captures command errors and uncaught issues automatically when enabled; see [docs/SENTRY_SETUP.md](docs/SENTRY_SETUP.md) for setup and tuning.

## Troubleshooting (Fast)

- Slash commands not visible -> ensure the bot is in the server and run `npm run deploy:cmds`.
- Cannot pin Gate Entry (Discord 50013) -> grant the bot **Manage Messages** in the gate channel and rerun `/gate ensure-entry`.
- Sentry prompts during startup -> it is optional; ignore the DSN request if you do not need error reporting.

## License

Licensed under Attribution-No Wholesale Copying License, Version 1.0 (LicenseRef-ANW-1.0). See [LICENSE](LICENSE). Portions may be reused within excerpt limits with attribution (see NOTICE).
