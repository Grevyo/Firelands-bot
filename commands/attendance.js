const { SlashCommandBuilder } = require('discord.js');
const { loadDb } = require('../utils/database');

function isCoach(member, teamRoles) {
  return Object.values(teamRoles).some((team) => member.roles.cache.has(team.coach));
}

function getCoachTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.coach))
    .map(([team]) => team);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('Show attendance report for upcoming events'),

  async execute(interaction, context) {
    const config = context.getConfig();
    const teamRoles = config.roles;

    if (!isCoach(interaction.member, teamRoles)) {
      await interaction.reply({ content: 'Only coaches can run this command.', ephemeral: true });
      return;
    }

    const coachTeams = getCoachTeams(interaction.member, teamRoles);
    const db = loadDb();
    const now = new Date();

    const relevantEvents = Object.entries(db.events)
      .map(([eventId, event]) => ({ eventId, ...event }))
      .filter((event) => coachTeams.includes(event.team))
      .filter((event) => new Date(event.date) >= new Date(now.getTime() - 2 * 60 * 60 * 1000))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!relevantEvents.length) {
      await interaction.reply({ content: 'No upcoming events were found for your team(s).', ephemeral: true });
      return;
    }

    const chunks = [];

    for (const event of relevantEvents) {
      const guildRole = interaction.guild.roles.cache.get(teamRoles[event.team].player);
      const playerIds = guildRole ? Array.from(guildRole.members.keys()) : [];
      const responses = event.responses || {};

      const attending = [];
      const confirmedNo = [];
      const pendingNo = [];

      for (const [userId, response] of Object.entries(responses)) {
        if (response.status === 'yes') attending.push(`<@${userId}>`);
        if (response.status === 'confirmed_no') {
          confirmedNo.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
        }
        if (response.status === 'pending_no') {
          pendingNo.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
        }
      }

      const respondedIds = new Set(Object.keys(responses));
      const noResponse = playerIds.filter((id) => !respondedIds.has(id)).map((id) => `<@${id}>`);

      chunks.push([
        `📅 **${event.title}**`,
        `🕒 ${new Date(event.date).toLocaleString()}`,
        '',
        '🟢 **Attending:**',
        attending.length ? attending.join('\n') : '*None*',
        '',
        '🔴 **Not Attending (Confirmed):**',
        confirmedNo.length ? confirmedNo.join('\n') : '*None*',
        '',
        '⚪ **Pending:**',
        pendingNo.length ? pendingNo.join('\n') : '*None*',
        '',
        '❓ **No Response:**',
        noResponse.length ? noResponse.join('\n') : '*None*'
      ].join('\n'));
    }

    const output = chunks.join('\n\n-------------------------\n\n');

    if (output.length > 1900) {
      await interaction.reply({ content: 'Attendance report is too long. Please narrow scope in future version.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: output, ephemeral: true });
  }
};
