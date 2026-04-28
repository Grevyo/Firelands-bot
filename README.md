# 🔥 Firelands Bot

Professional Discord operations bot for football clubs — built for **Firelands United**.

It helps your staff run fixtures, attendance, player/coach management, absence workflows, and Google integrations from one admin UI.

---

## ✨ What the bot does

- 📅 Syncs fixtures from **Google Calendar**.
- 📣 Posts and manages fixture attendance prompts in Discord.
- ✅ Tracks player/coach responses (attending / not attending).
- 🎟️ Runs absence ticket flow with coach confirmation.
- 🧑‍💼 Provides an in-Discord **Admin Panel** for setup and management.
- 📊 Supports **Google Sheets** sync for fixtures, attendance, config, backups, and logs.

---

## 🧱 Tech stack

- **Node.js** (CommonJS)
- `discord.js`
- `googleapis`
- `node-cron`

---

## 📁 Project structure

- `index.js` — bot bootstrap, setup wizard, startup flows.
- `events/interactionCreate.js` — button/select/modal handlers and admin UI actions.
- `commands/` — slash commands (`/admin`, `/player`, `/coach`, `/attendance`, `/confirm`).
- `utils/` — config, database, Google Calendar + Sheets sync utilities.
- `scripts/setupGoogleSheet.js` — helper script to initialize required sheet tabs and headers.
- `docs/GOOGLE_DRIVE_INTEGRATION.md` — deep dive on Google integration behavior.

---

## ✅ Prerequisites

Before setup, ensure you have:

- Node.js **18+**
- A Discord server where you have **Manage Server** permissions
- A Discord application + bot token
- (Optional but recommended) Google service account credentials JSON for Calendar/Sheets features

---

## 🤖 Add the bot to your Discord server

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create (or open) your application.
3. In **Bot**, create/reset token and keep it secure.
4. In **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions (recommended):
     - Send Messages
     - Embed Links
     - Read Message History
     - Manage Channels (for absence ticket flow)
     - Manage Roles (if your setup requires role updates)
5. Open the generated URL and invite the bot to your target server.

---

## ⚙️ Local installation

```bash
npm install
```

Create environment variables (minimum viable setup):

```bash
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_discord_app_client_id
DISCORD_GUILD_ID=your_discord_server_id

CALENDAR_ID=your_google_calendar_id
CALENDAR_CREDENTIALS_PATH=./credentials.json
```

Start the bot:

```bash
npm start
```

---

## 🧭 Firelands Bot setup flow (inside Discord)

After the bot starts:

1. Run `/admin panel` (or use your setup entrypoint message).
2. Open **🏟️ Club Management**.
3. Open **📗 Google** tools.
4. Configure essentials:
   - 🛎️ Admin chat channel
   - 💬 Bot commands channel
   - Google Calendar / Sheet settings
5. Run **🔄 Sync Calendar → Fixtures** to push events into the `Fixtures` tab.
6. Use team management to map:
   - player role IDs
   - coach role IDs
   - team chats / staff rooms / absence categories
7. Test with one fixture:
   - attendance prompt
   - player response
   - absence handling

✅ Once this works for one team, repeat for all teams.

---

## 📗 Google Sheets (optional but recommended)

Enable with env vars:

```bash
GOOGLE_SYNC_ENABLED=true
GOOGLE_SPREADSHEET_ID=<spreadsheet_id_or_url>
GOOGLE_COMMAND_LOG_RANGE='Command Logs'!A2:I
GOOGLE_FIXTURES_RANGE=Fixtures!A2:G
GOOGLE_ATTENDANCE_RANGE=Attendance!A2:F
```

Then share the spreadsheet with your service account as **Editor**.

### Quick sheet bootstrap

```bash
CALENDAR_CREDENTIALS_PATH=/path/to/service-account.json \
node scripts/setupGoogleSheet.js "https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit"
```

---

## 🗃️ Runtime data

- `config.json` — active runtime configuration and saved backups.
- `data.json` — fixtures, attendance state, profiles, tickets, and operational bot data.

---

## 🩺 Troubleshooting

- ❌ **No fixtures found** → verify `CALENDAR_ID` and calendar permissions.
- ❌ **Google auth errors** → verify `CALENDAR_CREDENTIALS_PATH` points to a valid JSON key.
- ❌ **Sheet write errors** → ensure spreadsheet is shared as Editor with service account email.
- ⚠️ **Wrong ranges/tab names** → confirm A1 ranges use exact sheet tab names.

For full details, read `docs/GOOGLE_DRIVE_INTEGRATION.md`.

---

## 🤝 Contributing

1. Create a branch
2. Make focused changes
3. Validate locally
4. Open PR with summary + testing notes

---

## 📄 License

No license file is currently included.
Add one (for example MIT) before public distribution.
