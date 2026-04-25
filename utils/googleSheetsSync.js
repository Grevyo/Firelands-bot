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
  return config.googleSync?.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || '';
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

module.exports = {
  getSheetsClient,
  loadAttendanceFromSheet,
  appendAttendanceRow,
  mapAttendanceRow,
  getSpreadsheetId
};
