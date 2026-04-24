const { google } = require('googleapis');

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

async function fetchUpcomingEvents({ calendarId, daysAhead = 14 }) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
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

module.exports = {
  fetchUpcomingEvents,
  detectTeamFromTitle,
  getEventStartIso
};
