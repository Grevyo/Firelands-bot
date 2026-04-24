const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function detectTeamFromTitle(title = '') {
  const normalized = title.toLowerCase();

  // womens must be checked before mens because "womens" includes "mens"
  if (normalized.includes('womens')) return 'womens';
  if (normalized.includes('mens')) return 'mens';
  return null;
}

function getEventStartIso(event) {
  return event?.start?.dateTime || event?.start?.date || null;
}

async function fetchUpcomingEvents({ calendarId, daysAhead = 14, credentialsPath = '' }) {
  const resolvedCredentialsPath = resolveCredentialsPath(credentialsPath);

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedCredentialsPath,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  });

  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const max = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });

  const items = response.data.items || [];

  return items
    .map((event) => {
      const startIso = getEventStartIso(event);
      const title = event.summary || 'Untitled Event';
      const team = detectTeamFromTitle(title);

      if (!event.id || !startIso || !team) return null;

      return {
        id: event.id,
        title,
        date: startIso,
        team
      };
    })
    .filter(Boolean);
}

function resolveCredentialsPath(credentialsPath = '') {
  const configuredPath = credentialsPath || process.env.CALENDAR_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;

  const localPath = path.join(process.cwd(), 'credentials.json');
  if (fs.existsSync(localPath)) return localPath;

  throw new Error(
    `Google Calendar credentials file not found. Set CALENDAR_CREDENTIALS_PATH (or GOOGLE_APPLICATION_CREDENTIALS) to an existing file. Looked for: ${configuredPath || '(not set)'}, ${localPath}`
  );
}

module.exports = {
  fetchUpcomingEvents,
  resolveCredentialsPath,
  detectTeamFromTitle,
  getEventStartIso
};
