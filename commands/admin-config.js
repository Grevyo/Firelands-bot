const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadConfig, updateConfig } = require('../utils/config');

const FIELD_MAP = {
  bot_token_reference: 'bot.tokenReference',
  mens_player_role_id: 'roles.mens.player',
  womens_player_role_id: 'roles.womens.player',
  mens_coach_role_id: 'roles.mens.coach',
  womens_coach_role_id: 'roles.womens.coach',
  events_channel_id: 'channels.events',
  logs_channel_id: 'channels.logs',
  ticket_channel_id: 'channels.ticket'
};

function isSnowflake(value) {
  return /^\d{8,25}$/.test(value);
}

function validateField(field, value) {
  if (field === 'bot_token_reference') return value.length >= 10;
  return isSnowflake(value);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-config')
    .setDescription('View or update Firelands United bot configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View current bot configuration')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Update a specific configuration field')
        .addStringOption((opt) =>
          opt
            .setName('field')
            .setDescription('Configuration field to update')
            .setRequired(true)
            .addChoices(
              { name: 'Bot token reference', value: 'bot_token_reference' },
              { name: 'Mens player role ID', value: 'mens_player_role_id' },
              { name: 'Womens player role ID', value: 'womens_player_role_id' },
              { name: 'Mens coach role ID', value: 'mens_coach_role_id' },
              { name: 'Womens coach role ID', value: 'womens_coach_role_id' },
              { name: 'Events channel ID', value: 'events_channel_id' },
              { name: 'Logs channel ID', value: 'logs_channel_id' },
              { name: 'Ticket channel/category ID', value: 'ticket_channel_id' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('value')
            .setDescription('New value')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Administrator permission is required.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const config = loadConfig();
      const message = [
        '**Firelands United Bot Configuration**',
        '',
        `Bot Token Reference: ${config.bot.tokenReference ? '`set`' : '`not set`'}`,
        `Mens Player Role: ${config.roles.mens.player || 'not set'}`,
        `Womens Player Role: ${config.roles.womens.player || 'not set'}`,
        `Mens Coach Role: ${config.roles.mens.coach || 'not set'}`,
        `Womens Coach Role: ${config.roles.womens.coach || 'not set'}`,
        `Events Channel: ${config.channels.events || 'not set'}`,
        `Logs Channel: ${config.channels.logs || 'not set'}`,
        `Ticket Channel/Category: ${config.channels.ticket || 'not set'}`,
        '',
        '_Note: Bot token changes are stored for restart/reference and do not hot-swap runtime auth._'
      ].join('\n');

      await interaction.reply({ content: message, ephemeral: true });
      return;
    }

    const field = interaction.options.getString('field', true);
    const value = interaction.options.getString('value', true).trim();

    if (!validateField(field, value)) {
      await interaction.reply({
        content: field === 'bot_token_reference'
          ? 'Invalid token reference format.'
          : 'Invalid ID format. Expected a Discord snowflake.',
        ephemeral: true
      });
      return;
    }

    const configPath = FIELD_MAP[field];
    updateConfig(configPath, value);

    await interaction.reply({
      content: `✅ Updated **${field}**. ${field === 'bot_token_reference' ? 'Restart bot to use new token.' : ''}`,
      ephemeral: true
    });
  }
};
