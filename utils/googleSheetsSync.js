const { google } = require('googleapis');

function toIso(date = new Date()) {
  return new Date(date).toISOString();
}

function resolveCredentialsPath(config = {}) {
  return config.bot?.calendarCredentialsPath
    || process.env.CALENDAR_CREDENTIALS_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || 'credentials.json';
}

function getSpreadsheetId(config = {}) {
  const input = config.googleSync?.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || '';
  const match = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : String(input).trim();
}

async function getSheetsClient(config = {}) {
  const auth = new google.auth.GoogleAuth({
    keyFile: resolveCredentialsPath(config),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

function mapAttendanceRow(row = []) {
  return {
    eventId: row[0] || '',
    userId: row[1] || '',
    username: row[2] || '',
    team: row[3] || '',
    status: row[4] || '',
    updatedAt: row[5] || ''
  };
}

async function loadAttendanceFromSheet(config = {}, range = 'Attendance!A2:F') {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return [];

  const sheets = await getSheetsClient(config);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

  return (response.data.values || []).map(mapAttendanceRow);
}

async function appendAttendanceRow(config = {}, attendance = {}, range = 'Attendance!A2:F') {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return false;

  const sheets = await getSheetsClient(config);
  const row = [
    attendance.eventId || '',
    attendance.userId || '',
    attendance.username || '',
    attendance.team || '',
    attendance.status || '',
    attendance.updatedAt || toIso()
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  return true;
}

function normalizeAttendanceStatus(status = '') {
  if (status === 'yes') return 'attending';
  if (status === 'pending_no' || status === 'confirmed_no') return 'not_attending';
  return status || '';
}

function buildFixtureRows(db = {}) {
  return Object.entries(db.events || {})
    .map(([eventId, event]) => ({
      eventId,
      title: event.title || '',
      date: event.date || '',
      team: event.team || '',
      discordMessageId: event.discordMessageId || '',
      updatedAt: event.updatedAt || toIso()
    }))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
    .map((event) => [
      event.eventId,
      event.title,
      event.date,
      event.team,
      event.discordMessageId,
      event.updatedAt
    ]);
}

function buildAttendanceRows(db = {}) {
  const rows = [];
  const events = db.events || {};

  for (const [eventId, event] of Object.entries(events)) {
    const responses = event.responses || {};
    for (const [userId, response] of Object.entries(responses)) {
      rows.push([
        eventId,
        userId,
        response.username || '',
        event.team || '',
        normalizeAttendanceStatus(response.status || ''),
        response.updatedAt || toIso()
      ]);
    }
  }

  return rows.sort((a, b) => new Date(a[5] || 0).getTime() - new Date(b[5] || 0).getTime());
}

function flattenConfig(config = {}, prefix = '') {
  const entries = [];
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenConfig(value, path));
      continue;
    }

    entries.push([path, String(value ?? ''), toIso()]);
  }

  return entries;
}

async function writeRange(sheets, spreadsheetId, range, values) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  if (!values.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

async function syncAllToSheet(config = {}, db = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const fixturesRange = config.googleSync?.fixturesRange || 'Fixtures!A2:F';
  const attendanceRange = config.googleSync?.attendanceRange || 'Attendance!A2:F';
  const configRange = config.googleSync?.configRange || 'Config!A2:C';

  await writeRange(sheets, spreadsheetId, fixturesRange, buildFixtureRows(db));
  await writeRange(sheets, spreadsheetId, attendanceRange, buildAttendanceRows(db));
  await writeRange(sheets, spreadsheetId, configRange, flattenConfig(config));

  return { ok: true, spreadsheetId };
}

module.exports = {
  getSheetsClient,
  loadAttendanceFromSheet,
  appendAttendanceRow,
  mapAttendanceRow,
  getSpreadsheetId,
  buildFixtureRows,
  buildAttendanceRows,
  flattenConfig,
  syncAllToSheet
};
