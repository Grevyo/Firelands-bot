const cron = require('node-cron');
const { loadDb, markPostEventReminder } = require('./database');

function hoursUntil(dateString) {
  const diff = new Date(dateString).getTime() - Date.now();
  return diff / (1000 * 60 * 60);
}

function isWithinWindow(value, target, tolerance = 1) {
  return Math.abs(value - target) <= tolerance;
}

async function sendNoResponseReminders(client, config) {
  const db = loadDb();

  for (const [, event] of Object.entries(db.events)) {
    const remainingHours = hoursUntil(event.date);

    if (!isWithinWindow(remainingHours, 48, 1)) continue;

    const guild = client.guilds.cache.get(config.bot.guildId) || client.guilds.cache.first();
    if (!guild) continue;

    const roleId = config.roles[event.team]?.player;
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    const responders = new Set(Object.keys(event.responses || {}));

    for (const [userId] of role.members) {
      if (responders.has(userId)) continue;

      try {
        const user = await client.users.fetch(userId);
        await user.send(`⚠️ You have not responded to ${event.title}. Please mark attendance.`);
      } catch (error) {
        console.error(`Failed sending 48h reminder to ${userId}:`, error.message);
      }
    }
  }
}

async function sendPostEventCoachVerification(client, config) {
  const db = loadDb();

  for (const [eventId, event] of Object.entries(db.events)) {
    const remainingHours = hoursUntil(event.date);
    const alreadySent = !!db.meta?.postEventCoachReminders?.[eventId];

    if (remainingHours > -1) continue;
    if (alreadySent) continue;

    const guild = client.guilds.cache.get(config.bot.guildId) || client.guilds.cache.first();
    if (!guild) continue;

    const coachRoleId = config.roles[event.team]?.coach;
    if (!coachRoleId) continue;

    const coachRole = guild.roles.cache.get(coachRoleId);
    if (!coachRole) continue;

    for (const [coachId] of coachRole.members) {
      try {
        const coach = await client.users.fetch(coachId);
        await coach.send(`Please confirm final attendance for ${event.title}`);
      } catch (error) {
        console.error(`Failed sending coach verification DM to ${coachId}:`, error.message);
      }
    }

    markPostEventReminder(eventId, true);
  }
}

function startReminderJobs(client, getConfig) {
  cron.schedule('0 * * * *', async () => {
    try {
      const config = getConfig();
      await sendNoResponseReminders(client, config);
      await sendPostEventCoachVerification(client, config);
    } catch (error) {
      console.error('Reminder job failed:', error);
    }
  });
}

module.exports = {
  startReminderJobs,
  sendNoResponseReminders,
  sendPostEventCoachVerification
};
