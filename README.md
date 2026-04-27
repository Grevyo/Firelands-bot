# Firelands Bot

A Discord bot for club operations at Firelands United: fixture announcements, attendance tracking, coach/player tools, and optional Google Sheets sync/backups.

## What this project does

- Pulls fixtures from Google Calendar and posts/updates them in Discord.
- Lets players/coaches respond to attendance with Discord interactions.
- Stores operational data locally (`config.json`, `data.json`) for reliability.
- Supports Google Sheets sync for fixtures, attendance, config snapshots, and command logs.
- Includes an in-Discord setup wizard for role/channel/Google connection setup.

## Tech stack

- Node.js (CommonJS)
- `discord.js`
- `googleapis`
- `node-cron`

## Repository structure

- `index.js` — app entrypoint, setup wizard flow, startup + command registration.
- `commands/` — slash commands (`/attendance`, `/player`, `/coach`, `/admin`, `/confirm`).
- `events/interactionCreate.js` — interaction routing and button/modal handling.
- `utils/` — Google Calendar/Sheets, config, reminders, DB helpers.
- `scripts/setupGoogleSheet.js` — one-command Google Sheet tab/header bootstrap.
- `docs/GOOGLE_DRIVE_INTEGRATION.md` — detailed Google integration guide.

## Prerequisites

- Node.js 18+ recommended.
- A Discord application + bot token.
- A Google service account JSON key file (for Calendar/Sheets features).

## Quick start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables** (minimum)
   ```bash
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_app_client_id
   DISCORD_GUILD_ID=your_test_guild_id

   CALENDAR_ID=your_google_calendar_id
   CALENDAR_CREDENTIALS_PATH=./credentials.json
   ```

3. **Run the bot**
   ```bash
   npm start
   ```

4. In Discord, open the setup flow and complete:
   - admin role
   - admin logs channel
   - Google Calendar ID (or URL)
   - Google Sheet URL/ID (if enabling sync)

## Google Sheets sync (optional)

Enable sync via env vars or `config.json`:

```bash
GOOGLE_SYNC_ENABLED=true
GOOGLE_SPREADSHEET_ID=<spreadsheet_id_or_sheet_url>
GOOGLE_COMMAND_LOG_RANGE='Command Logs'!A2:I
GOOGLE_FIXTURES_RANGE=Fixtures!A2:F
GOOGLE_ATTENDANCE_RANGE=Attendance!A2:F
```

Then share the spreadsheet as **Editor** with your service account email.

### Bootstrap a sheet quickly

```bash
CALENDAR_CREDENTIALS_PATH=/path/to/service-account.json \
node scripts/setupGoogleSheet.js "https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit"
```

This creates/normalizes expected tabs and header rows.

## Available npm scripts

- `npm start` — starts the bot.

## Data files

- `config.json` — runtime configuration (roles/channels/ranges/team metadata).
- `data.json` — persisted bot state (events, attendance, setup metadata, etc.).

## Troubleshooting

- **Google permission errors**: ensure Calendar + Sheet are shared with the service account.
- **Sheet range parse errors**: confirm tab names/ranges are valid (example: `'Command Logs'!A2:I`).
- **Missing credentials file**: check `CALENDAR_CREDENTIALS_PATH` points to a readable JSON key.
- **No events pulled**: verify Calendar ID and that events exist in the queried window.

For deeper Google setup details, see `docs/GOOGLE_DRIVE_INTEGRATION.md`.

## Contributing

1. Create a branch.
2. Make focused changes.
3. Run checks locally.
4. Open a PR with a clear summary and testing notes.

## License

No license file is currently included. Add one (e.g., MIT) before public open-source distribution.
