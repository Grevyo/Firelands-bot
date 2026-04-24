const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ events: {}, meta: { postEventCoachReminders: {} } }, null, 2)
    );
  }
}

function loadDb() {
  ensureDb();

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed.events) parsed.events = {};
    if (!parsed.meta) parsed.meta = {};
    if (!parsed.meta.postEventCoachReminders) parsed.meta.postEventCoachReminders = {};

    return parsed;
  } catch (error) {
    console.error('Failed to load database:', error);
    return { events: {}, meta: { postEventCoachReminders: {} } };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function upsertEvent(eventId, payload) {
  const db = loadDb();

  db.events[eventId] = {
    ...(db.events[eventId] || {}),
    ...payload,
    responses: (db.events[eventId] && db.events[eventId].responses) || payload.responses || {}
  };

  saveDb(db);
  return db.events[eventId];
}

function setEventMessageId(eventId, messageId) {
  const db = loadDb();
  if (!db.events[eventId]) return;

  db.events[eventId].discordMessageId = messageId;
  saveDb(db);
}

function setResponse(eventId, userId, response) {
  const db = loadDb();
  if (!db.events[eventId]) return null;

  if (!db.events[eventId].responses) db.events[eventId].responses = {};

  db.events[eventId].responses[userId] = {
    ...(db.events[eventId].responses[userId] || {}),
    ...response
  };

  saveDb(db);
  return db.events[eventId].responses[userId];
}

function markPostEventReminder(eventId, marked = true) {
  const db = loadDb();
  db.meta.postEventCoachReminders[eventId] = marked;
  saveDb(db);
}

module.exports = {
  loadDb,
  saveDb,
  upsertEvent,
  setEventMessageId,
  setResponse,
  markPostEventReminder
};
