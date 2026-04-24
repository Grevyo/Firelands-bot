const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { loadDb, setResponse } = require('../utils/database');
const { updateConfig } = require('../utils/config');
const { fetchCalendarEvents } = require('../utils/googleCalendar');
const coachCommand = require('../commands/coach');

const ADMIN_ROLE_ACTIONS = {
  set_mens_player_role: { path: 'roles.mens.player', label: 'Mens Player Role' },
  set_mens_coach_role: { path: 'roles.mens.coach', label: 'Mens Coach Role' },
  set_womens_player_role: { path: 'roles.womens.player', label: 'Womens Player Role' },
  set_womens_coach_role: { path: 'roles.womens.coach', label: 'Womens Coach Role' }
};

const ADMIN_CHANNEL_ACTIONS = {
  set_mens_team_channel: { path: 'channels.teamChats.mens', label: 'Mens Team Chat Channel' },
  set_womens_team_channel: { path: 'channels.teamChats.womens', label: 'Womens Team Chat Channel' }
};

function createAdminQuickActionRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_quick_action')
      .setPlaceholder('Pick an action')
      .addOptions([
        { label: 'Set Google Calendar ID', value: 'set_calendar_id', description: 'Update the calendar used by sync' },
        { label: 'Set Mens Player Role', value: 'set_mens_player_role', description: 'Assign Mens team player role' },
        { label: 'Set Mens Coach Role', value: 'set_mens_coach_role', description: 'Assign Mens team coach role' },
        { label: 'Set Womens Player Role', value: 'set_womens_player_role', description: 'Assign Womens team player role' },
        { label: 'Set Womens Coach Role', value: 'set_womens_coach_role', description: 'Assign Womens team coach role' },
        { label: 'Set Mens Team Chat', value: 'set_mens_team_channel', description: 'Assign Mens team chat channel' },
        { label: 'Set Womens Team Chat', value: 'set_womens_team_channel', description: 'Assign Womens team chat channel' },
        { label: 'View Google Calendar Events', value: 'view_google_events', description: 'Show upcoming events from Google Calendar' },
        { label: 'Club Report', value: 'club_report', description: 'View club attendance report' },
        { label: 'Config Help', value: 'config_help', description: 'Show config usage notes' }
      ])
  );
}

function parseCustomId(customId) {
  const [action, eventId, userId] = customId.split(':');
  return { action, eventId, userId };
}

function hasRole(member, roleId) {
  return !!member.roles.cache.get(roleId);
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, context) {
    const config = context.getConfig();
    const teamRolesMap = config.roles;

    if (interaction.isButton()) {
      const parsed = parseCustomId(interaction.customId);
      const db = loadDb();
      const event = db.events[parsed.eventId];

      if (!event) {
        await interaction.reply({ content: 'Event not found.', ephemeral: true });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!teamRoles) {
        await interaction.reply({ content: 'Team roles are not configured for this event.', ephemeral: true });
        return;
      }

      if (parsed.action === 'attend_yes') {
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
          return;
        }

        setResponse(parsed.eventId, interaction.user.id, {
          status: 'yes',
          reason: '',
          confirmed: false
        });

        await interaction.reply({ content: '✅ You are marked as attending.', ephemeral: true });
        return;
      }

      if (parsed.action === 'attend_no') {
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`absence_reason:${parsed.eventId}`)
          .setTitle('Not Attending');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for not attending')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
      }

      if (parsed.action === 'confirm_no') {
        const targetUserId = parsed.userId;

        if (!targetUserId) {
          await interaction.reply({ content: 'Invalid confirmation button.', ephemeral: true });
          return;
        }

        if (!hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only coaches can confirm absences.', ephemeral: true });
          return;
        }

        const existing = db.events[parsed.eventId]?.responses?.[targetUserId];

        if (!existing || existing.status !== 'pending_no') {
          await interaction.reply({ content: 'This absence is no longer pending.', ephemeral: true });
          return;
        }

        setResponse(parsed.eventId, targetUserId, {
          status: 'confirmed_no',
          confirmed: true
        });

        await interaction.reply({ content: `✅ Absence confirmed for <@${targetUserId}>.`, ephemeral: false });

        try {
          await interaction.channel.permissionOverwrites.edit(teamRoles.player, {
            SendMessages: false
          });
        } catch (error) {
          console.error('Failed to lock ticket channel:', error);
        }

        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'coach_team_select') {
        const selectedTeam = interaction.values[0];
        const report = coachCommand.buildReport(interaction.guild, selectedTeam, teamRolesMap);

        const embed = new EmbedBuilder()
          .setTitle(`Coach UI — ${selectedTeam}`)
          .setDescription(report)
          .setColor(0x3498db);

        await interaction.update({ content: 'Coach report loaded.', embeds: [embed], components: [] });
        return;
      }

      if (interaction.customId === 'admin_quick_action') {
        const action = interaction.values[0];
        const roleAction = ADMIN_ROLE_ACTIONS[action];

        if (roleAction) {
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:${roleAction.path}`)
              .setPlaceholder(`Choose ${roleAction.label}`)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the role to assign for **${roleAction.label}**.`,
            embeds: [],
            components: [row]
          });
          return;
        }

        const channelAction = ADMIN_CHANNEL_ACTIONS[action];
        if (channelAction) {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:${channelAction.path}`)
              .setPlaceholder(`Choose ${channelAction.label}`)
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the channel to assign for **${channelAction.label}**.`,
            embeds: [],
            components: [row]
          });
          return;
        }

        if (action === 'set_calendar_id') {
          const modal = new ModalBuilder()
            .setCustomId('admin_set_calendar_modal')
            .setTitle('Set Google Calendar ID');

          const calendarIdInput = new TextInputBuilder()
            .setCustomId('calendar_id')
            .setLabel('Google Calendar ID (email-like)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(config.bot.calendarId || '')
            .setMaxLength(150);

          modal.addComponents(new ActionRowBuilder().addComponents(calendarIdInput));
          await interaction.showModal(modal);
          return;
        }

        if (action === 'view_google_events') {
          try {
            const events = await fetchCalendarEvents({
              calendarId: config.bot.calendarId,
              daysAhead: 60,
              credentialsPath: config.bot.calendarCredentialsPath || ''
            });

            const lines = events.length
              ? events.slice(0, 20).map((event) => {
                const date = new Date(event.date).toLocaleString();
                return `• ${date} — **${event.title}**${event.team ? ` (${event.team})` : ''}`;
              })
              : ['No upcoming events found in the next 60 days.'];

            const embed = new EmbedBuilder()
              .setTitle('Google Calendar — Upcoming Club Events')
              .setDescription(lines.join('\n'))
              .setColor(0x2ecc71)
              .setFooter({ text: events.length > 20 ? `Showing first 20 of ${events.length} events` : `Showing ${events.length} events` });

            await interaction.update({
              content: 'Loaded Google Calendar events.',
              embeds: [embed],
              components: [createAdminQuickActionRow()]
            });
          } catch (error) {
            await interaction.update({
              content: `Could not load calendar events: ${error.message}`,
              embeds: [],
              components: [createAdminQuickActionRow()]
            });
          }
          return;
        }

        if (action === 'club_report') {
          await interaction.update({
            content: 'Run `/admin club-report` to open the full club attendance report.',
            embeds: [],
            components: [createAdminQuickActionRow()]
          });
          return;
        }

        await interaction.update({
          content: 'Use `/admin-config view` or `/admin-config set` for detailed configuration updates.',
          embeds: [],
          components: [createAdminQuickActionRow()]
        });
        return;
      }
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('admin_set_role:')) {
      const configPath = interaction.customId.split(':')[1];
      const roleId = interaction.values[0];
      updateConfig(configPath, roleId);

      await interaction.update({
        content: `✅ Updated **${configPath}** to <@&${roleId}>.`,
        embeds: [],
        components: [createAdminQuickActionRow()]
      });
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('admin_set_channel:')) {
      const configPath = interaction.customId.split(':')[1];
      const channelId = interaction.values[0];
      updateConfig(configPath, channelId);

      await interaction.update({
        content: `✅ Updated **${configPath}** to <#${channelId}>.`,
        embeds: [],
        components: [createAdminQuickActionRow()]
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('absence_reason:')) {
      const eventId = interaction.customId.split(':')[1];
      const db = loadDb();
      const event = db.events[eventId];

      if (!event) {
        await interaction.reply({ content: 'Event no longer exists.', ephemeral: true });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!hasRole(interaction.member, teamRoles.player)) {
        await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
        return;
      }

      const reason = interaction.fields.getTextInputValue('reason').trim();

      setResponse(eventId, interaction.user.id, {
        status: 'pending_no',
        reason,
        confirmed: false
      });

      const shortEventId = eventId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
      const channelName = sanitizeChannelName(`ticket-${interaction.user.username}-${shortEventId}`);

      let ticketChannel;
      try {
        ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: config.channels.ticket || null,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: interaction.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
              id: teamRoles.coach,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });
      } catch (error) {
        console.error('Failed to create ticket channel:', error);
      }

      if (ticketChannel) {
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_no:${eventId}:${interaction.user.id}`)
          .setLabel('✅ Confirm Absence')
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        await ticketChannel.send({
          content: `${interaction.user} cannot attend **${event.title}**\nReason: ${reason}`,
          components: [row]
        });
      }

      await interaction.reply({
        content: '🔴 Your absence was submitted and is pending coach confirmation.',
        ephemeral: true
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_set_calendar_modal') {
      const calendarId = interaction.fields.getTextInputValue('calendar_id').trim();

      if (!calendarId) {
        await interaction.reply({ content: 'Calendar ID cannot be empty.', ephemeral: true });
        return;
      }

      updateConfig('bot.calendarId', calendarId);
      await interaction.reply({ content: `✅ Updated **bot.calendarId** to \`${calendarId}\`.`, ephemeral: true });
    }
  }
};
