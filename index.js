const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  REST,
  Routes,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const cron = require('node-cron');

const attendanceCommand = require('./commands/attendance');
const playerCommand = require('./commands/player');
const coachCommand = require('./commands/coach');
const adminCommand = require('./commands/admin');
const confirmCommand = require('./commands/confirm');
const interactionHandler = require('./events/interactionCreate');
const { fetchUpcomingEvents } = require('./utils/googleCalendar');
const { loadDb, saveDb, upsertEvent, setEventMessageId } = require('./utils/database');
const { startReminderJobs } = require('./utils/reminders');
const { ensureConfig, loadConfig, saveConfig, updateConfig, resetConfigFresh } = require('./utils/config');
const {
  syncAllToSheet,
  appendCommandLogRow,
  loadSheetBackups,
  restoreSpreadsheetFromBackupSnapshot,
  loadConfigFromSheet,
  getSpreadsheetId,
  getSheetsClient
} = require('./utils/googleSheetsSync');
const { getTeamSetupProgress, getIncompleteTeamsForMember, buildIncompleteTeamMessage } = require('./utils/teamSetup');
const { fetchCalendarEvents } = require('./utils/googleCalendar');

ensureConfig();

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable for runtime login.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.commands.set(attendanceCommand.data.name, attendanceCommand);
client.commands.set(playerCommand.data.name, playerCommand);
client.commands.set(coachCommand.data.name, coachCommand);
client.commands.set(adminCommand.data.name, adminCommand);
client.commands.set(confirmCommand.data.name, confirmCommand);
const missingAttendanceConfigWarnings = new Set();

function buildSetupWelcome() {
  return [
    '👋 **Welcome to Firelands Bot**',
    '',
    'This setup will guide you through the essentials and get your club ready quickly.',
    '',
    '**Core features:**',
    '• Attendance tracking and fixture notifications.',
    '• Admin controls for team and channel configuration.',
    '• Google Sheets sync plus full-sheet backups (up to 5 slots).',
    '• Backup restore to repopulate all synced tabs from one saved snapshot.',
    '',
    'Made by **George Villiers** and published by **Grev**.',
    '',
    'Press **Get Started** to open the setup wizard.'
  ].join('\n');
}

function buildSetupSummary(config) {
  const draft = getSetupDraft();
  const adminRole = draft.adminRoleId ? `<@&${draft.adminRoleId}>` : 'not set';
  const adminChannel = draft.adminChannelId ? `<#${draft.adminChannelId}>` : 'not set';
  const calendarId = draft.calendarId || 'not set';
  const spreadsheetId = draft.spreadsheetId || 'not set';
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'firelands-bot-sync@firelands-bot-494321.iam.gserviceaccount.com';
  return [
    '⚙️ **Firelands Setup Wizard**',
    'Choose /admin access role and admin logs channel below, then configure Google Calendar + Google Sheet.',
    'Player and coach command access is automatically derived from team player/coach roles.',
    '',
    `• /admin access role: ${adminRole}`,
    `• Admin logs channel: ${adminChannel}`,
    `• Google Calendar ID: \`${calendarId}\``,
    `• Google Sheet ID: \`${spreadsheetId}\``,
    `• Share your Google Sheet as **Editor** with: \`${serviceAccountEmail}\``,
    '',
    'Click **Check Google connections** to verify the bot can read the calendar and write to the sheet.',
    'After checks pass, choose initialization mode:',
    '• **Fresh Config + Empty Sheets** = wipe data, rebuild all tabs with headings only.',
    '• **Load Backup Slot** = restore every synced tab from one saved backup line in the Backups sheet (max 5 slots).'
  ].join('\n');
}

function createSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup_role_admin')
        .setPlaceholder('Select role for /admin access')
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('setup_channel_admin')
        .setPlaceholder('Select admin logs channel')
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_set_calendar_id')
        .setLabel('🗓️ Set Google Calendar ID')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setup_set_sheet_url')
        .setLabel('📄 Set Google Sheet URL')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_validate_google')
        .setLabel('🔎 Check Google connections')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function createSetupModeRows() {
  return createSetupModeRowsWithBackup(true);
}

function createSetupModeRowsWithBackup(includeBackup = true) {
  const options = [
    { label: 'Fresh Config + Empty Sheets', value: 'fresh_config' }
  ];
  if (includeBackup) options.push({ label: 'Load Backup Slot', value: 'load_backup' });

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_sheet_mode')
        .setPlaceholder('Choose initialization action')
        .addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_back_to_mode')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createSetupWelcomeRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_get_started')
        .setLabel('Get Started')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function createSetupFinishRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_delete_message')
        .setLabel('Delete this message')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function createSetupBackupRows(backups = []) {
  const bySlot = new Map(backups.map((entry) => [entry.slot, entry]));
  const slotOptions = Array.from({ length: 5 }, (_, idx) => {
    const slot = idx + 1;
    const entry = bySlot.get(slot);
    return {
      label: `Slot ${slot} • ${entry?.name || (entry ? `Backup ${slot}` : 'Empty slot')}`.slice(0, 100),
      value: String(slot),
      description: (entry?.createdAt || 'No backup saved').slice(0, 100)
    };
  });

  const backupPickerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_restore_slot')
      .setPlaceholder('Choose backup slot to restore')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(slotOptions)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_back_to_mode')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

  return [backupPickerRow, backRow];
}

async function updateSetupMessageFromModal(interaction, sourceMessageId) {
  if (!sourceMessageId) return false;
  const channel = interaction.channel;
  if (!channel?.isTextBased()) return false;
  const targetMessage = await channel.messages.fetch(sourceMessageId).catch(() => null);
  if (!targetMessage) return false;
  await targetMessage.edit({
    content: buildSetupSummary(getConfig()),
    components: createSetupRows()
  }).catch(() => null);
  return true;
}

async function hasBackupsTab(config) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return false;
  const sheets = await getSheetsClient(config);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  return (metadata.data.sheets || []).some((sheet) => String(sheet.properties?.title || '').trim().toLowerCase() === 'backups');
}

function progressBar(percent = 0, width = 20) {
  const safePercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? Math.round(percent) : 0));
  const filled = Math.round((safePercent / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}] ${safePercent}%`;
}

function buildSetupRestoreProgressText(slot, progressState, done = false) {
  const safePercent = done ? 100 : Math.min(100, Math.max(0, Math.round(progressState.percent || 0)));
  return [
    `${done ? '✅' : '♻️'} ${done ? 'Backup import completed' : `Importing backup slot ${slot}`}`,
    '',
    `Loading: **${progressBar(safePercent)}**`,
    `ETA: **${Math.max(0, Math.round((progressState.etaMs || 0) / 1000))}s**`,
    `Current tab: ${progressState.currentTab || (done ? 'Complete' : 'starting…')}`,
    '',
    ...(progressState.tabs?.length ? progressState.tabs.map((tab) => `• ${tab}${!done && tab === progressState.currentTab ? ' ⏳' : ''}`) : ['• no tabs']),
    '',
    done ? 'Firelands Bot setup is complete and ready to use. Delete this message to finish setup.' : 'Please wait while Firelands imports this backup into all synced Google Sheet tabs.'
  ].join('\n');
}

function getConfig() {
  return loadConfig();
}

function parseCalendarId(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const cid = url.searchParams.get('cid');
    if (cid) return decodeURIComponent(cid).trim();

    const src = url.searchParams.get('src');
    if (src) return decodeURIComponent(src).trim();
  } catch (_) {
    return raw;
  }

  return raw;
}

function getSetupDraft(guildId = '') {
  const db = loadDb();
  if (!guildId) {
    const drafts = db.meta?.setupWizardDraft || {};
    return drafts._global || Object.values(drafts)[0] || {
      adminRoleId: '',
      adminChannelId: '',
      calendarId: '',
      spreadsheetId: ''
    };
  }
  const key = guildId || '_global';
  return db.meta?.setupWizardDraft?.[key] || {
    adminRoleId: '',
    adminChannelId: '',
    calendarId: '',
    spreadsheetId: ''
  };
}

function saveSetupDraft(update = {}, guildId = '') {
  const db = loadDb();
  const key = guildId || '_global';
  if (!db.meta) db.meta = {};
  if (!db.meta.setupWizardDraft) db.meta.setupWizardDraft = {};
  db.meta.setupWizardDraft[key] = {
    ...getSetupDraft(guildId),
    ...update
  };
  saveDb(db);
  return db.meta.setupWizardDraft[key];
}

function applySetupDraftToConfig(draft = {}) {
  if (draft.adminRoleId) updateConfig('bot.adminRoleId', draft.adminRoleId);
  if (draft.adminChannelId) updateConfig('channels.admin', draft.adminChannelId);
  if (draft.calendarId) updateConfig('bot.calendarId', draft.calendarId);
  if (draft.spreadsheetId) updateConfig('googleSync.spreadsheetId', draft.spreadsheetId);
}

function toOptionSummary(interaction) {
  try {
    const flat = (interaction.options?.data || []).map((option) => {
      const nested = (option.options || []).map((sub) => ({ name: sub.name, value: sub.value ?? null }));
      return { name: option.name, value: option.value ?? null, options: nested };
    });
    return JSON.stringify(flat);
  } catch {
    return '[]';
  }
}

function summarizeInteractionContext(interaction) {
  const parts = [];
  if (interaction.commandName) parts.push(`command=${interaction.commandName}`);
  if (interaction.customId) parts.push(`customId=${interaction.customId}`);
  if (interaction.user?.tag) parts.push(`user=${interaction.user.tag}`);
  if (interaction.guildId) parts.push(`guild=${interaction.guildId}`);
  if (interaction.channelId) parts.push(`channel=${interaction.channelId}`);
  return parts.join(' | ');
}

function formatInteractionError(error) {
  const code = error?.code ? `code=${error.code}` : '';
  const status = error?.status ? `status=${error.status}` : '';
  const message = String(error?.message || 'Unknown error');
  return [message, code, status].filter(Boolean).join(' | ');
}

async function logCommandUsage(interaction) {
  try {
    const config = getConfig();
    if (!config.googleSync?.enabled) return;

    let subcommand = '';
    try {
      subcommand = interaction.options?.getSubcommand(false) || '';
    } catch {
      subcommand = '';
    }

    await appendCommandLogRow(config, {
      source: 'slash',
      command: interaction.commandName,
      subcommand,
      options: toOptionSummary(interaction),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.tag
    });
  } catch (error) {
    await sendLog(`⚠️ Command log write failed: ${error.message}`);
  }
}

async function sendLog(message, fallbackChannelId = '') {
  const config = getConfig();
  const logsChannelId = config.channels.admin || config.channels.logs || fallbackChannelId;

  if (!logsChannelId) return;

  try {
    const logsChannel = await client.channels.fetch(logsChannelId);
    if (logsChannel && logsChannel.isTextBased()) {
      await logsChannel.send(message);
    }
  } catch (error) {
    console.error('Failed to write logs channel message:', error.message);
  }
}

async function registerSlashCommands() {
  const config = getConfig();
  const clientId = config.bot.clientId || process.env.DISCORD_CLIENT_ID;
  const guildId = config.bot.guildId || process.env.DISCORD_GUILD_ID;

  if (!clientId || !guildId) {
    console.error('Missing client or guild ID for slash command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    const guildBody = [
      attendanceCommand.data.toJSON(),
      playerCommand.data.toJSON(),
      coachCommand.data.toJSON(),
      adminCommand.data.toJSON(),
      confirmCommand.data.toJSON()
    ];
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: guildBody
    });
    await rest.put(Routes.applicationCommands(clientId), {
      body: [
        playerCommand.data.toJSON(),
        coachCommand.data.toJSON(),
        adminCommand.data.toJSON()
      ]
    });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
}

function formatEventDate(dateValue) {
  const date = new Date(dateValue);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function findGuildSetupChannel(guild) {
  if (guild.systemChannel?.isTextBased()) return guild.systemChannel;

  const candidate = guild.channels.cache
    .filter((channel) => channel.isTextBased() && channel.viewable)
    .sort((a, b) => a.position - b.position)
    .first();

  return candidate || null;
}

function hasCompletedSetupWizard(guildId) {
  const db = loadDb();
  return Boolean(db.meta?.setupWizard?.[guildId]?.completedAt);
}

function markSetupWizardCompleted(guildId) {
  const db = loadDb();
  if (!db.meta) db.meta = {};
  if (!db.meta.setupWizard) db.meta.setupWizard = {};
  db.meta.setupWizard[guildId] = {
    ...(db.meta.setupWizard[guildId] || {}),
    completedAt: new Date().toISOString()
  };
  saveDb(db);
}

async function postSetupWizardToGuild(guild) {
  if (hasCompletedSetupWizard(guild.id)) return;
  const setupChannel = findGuildSetupChannel(guild);
  if (!setupChannel) return;
  await setupChannel.send({
    content: buildSetupWelcome(),
    components: createSetupWelcomeRows()
  }).catch(() => null);
}

async function finalizeSetupWizard(interaction) {
  if (interaction.guildId) markSetupWizardCompleted(interaction.guildId);
  const setupChannel = interaction.channel;
  if (!setupChannel?.isTextBased()) return;

  const recentMessages = await setupChannel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recentMessages) {
    const setupMessages = recentMessages.filter((message) => {
      if (message.author?.id !== interaction.client.user?.id) return false;
      const text = `${message.content || ''} ${(message.components || []).map((row) => row.components.map((component) => component.customId || '').join(' ')).join(' ')}`;
      return text.includes('setup_')
        || text.includes('Firelands Setup Wizard')
        || text.includes('Welcome to Firelands Bot')
        || text.includes('Start using Firelands Bot');
    });
    await Promise.all(setupMessages.map((message) => message.delete().catch(() => null)));
  }
}

async function handleSetupInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isModalSubmit()) return false;
  if (!String(interaction.customId || '').startsWith('setup_')) return false;

  if (interaction.customId === 'setup_get_started' && interaction.isButton()) {
    if (!getSetupDraft(interaction.guildId).calendarId && !getSetupDraft(interaction.guildId).spreadsheetId) {
      saveSetupDraft({}, interaction.guildId);
    }
    await interaction.update({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows()
    }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_delete_message' && interaction.isButton()) {
    const member = interaction.member;
    const canDelete = Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageMessages) || member?.permissions?.has?.(PermissionFlagsBits.Administrator));
    if (!canDelete) {
      await interaction.reply({ content: 'Only admins can delete this setup message.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await interaction.message?.delete().catch(() => null);
    await interaction.reply({ content: '✅ Setup message deleted.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_back_to_mode' && interaction.isButton()) {
    await interaction.update({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows()
    }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_set_calendar_id' && interaction.isButton()) {
    const draft = getSetupDraft(interaction.guildId);
    const modal = new ModalBuilder().setCustomId(`setup_set_calendar_id_modal:${interaction.message?.id || ''}`).setTitle('Set Google Calendar ID');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('calendar_id')
          .setLabel('Google Calendar ID or URL')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.calendarId || '')
      )
    );
    await interaction.showModal(modal).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_set_sheet_url' && interaction.isButton()) {
    const draft = getSetupDraft(interaction.guildId);
    const modal = new ModalBuilder().setCustomId(`setup_set_sheet_url_modal:${interaction.message?.id || ''}`).setTitle('Set Google Sheet URL');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sheet_input')
          .setLabel('Google Sheet URL or Spreadsheet ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.spreadsheetId || '')
      )
    );
    await interaction.showModal(modal).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_validate_google' && interaction.isButton()) {
    await interaction.update({
      content: '🔎 Checking Google Calendar read access and Google Sheets write access...\nPlease wait.',
      components: []
    }).catch(() => null);

    const config = getConfig();
    const draft = getSetupDraft(interaction.guildId);
    const calendarId = draft.calendarId || '';
    const spreadsheetId = draft.spreadsheetId || '';
    if (!calendarId || !spreadsheetId) {
      await interaction.message?.edit({
        content: `❌ Missing Google details.\nCalendar ID: \`${calendarId || 'not set'}\`\nSheet ID: \`${spreadsheetId || 'not set'}\`\n\nPlease recheck your Calendar ID and Sheet URL/ID, then click **Check Google connections** again.`,
        components: createSetupRows()
      }).catch(() => null);
      return true;
    }

    try {
      await fetchCalendarEvents({
        calendarId,
        daysAhead: 7,
        credentialsPath: config.bot?.calendarCredentialsPath || '',
        teamMatchers: {}
      });
      const sheets = await getSheetsClient(config);
      const commandLogRange = String(config.googleSync?.commandLogRange || "'Command Logs'!A2:I").replace(/[\r\n]+/g, '').trim() || "'Command Logs'!A2:I";
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: commandLogRange,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[new Date().toISOString(), 'setup', 'connection_check', '', '', interaction.guildId || '', interaction.channelId || '', interaction.user?.id || '', interaction.user?.tag || 'setup']] }
      });
      const backupsTabAvailable = await hasBackupsTab(config).catch(() => false);
      await interaction.message?.edit({
        content: backupsTabAvailable
          ? '✅ Calendar read + Sheet write checks passed.\nNow choose initialization mode.'
          : '✅ Calendar read + Sheet write checks passed.\n⚠️ Could not load backups because no **Backups** tab was found in the Google Sheet.\nYou can continue with **Fresh Config + Empty Sheets**.',
        components: createSetupModeRowsWithBackup(backupsTabAvailable)
      }).catch(() => null);
    } catch (error) {
      await interaction.message?.edit({
        content: `❌ Google connection check failed: ${error.message}\n\nPlease recheck your Calendar ID and Sheet URL/ID, and make sure the sheet is shared as Editor with the service account email shown above.`,
        components: createSetupRows()
      }).catch(() => null);
    }
    return true;
  }
  if (interaction.customId.startsWith('setup_set_calendar_id_modal') && interaction.isModalSubmit()) {
    const calendarInput = interaction.fields.getTextInputValue('calendar_id').trim();
    const calendarId = parseCalendarId(calendarInput);
    saveSetupDraft({ calendarId }, interaction.guildId);
    const sourceMessageId = interaction.customId.split(':')[1] || '';
    const updated = await updateSetupMessageFromModal(interaction, sourceMessageId);
    await interaction.reply({
      content: updated
        ? '✅ Google Calendar ID saved. Setup wizard updated in-place.'
        : buildSetupSummary(getConfig()),
      ...(updated ? { flags: MessageFlags.Ephemeral } : { components: createSetupRows() })
    }).catch(() => null);
    return true;
  }
  if (interaction.customId.startsWith('setup_set_sheet_url_modal') && interaction.isModalSubmit()) {
    const input = interaction.fields.getTextInputValue('sheet_input').trim();
    saveSetupDraft({ spreadsheetId: getSpreadsheetId({ googleSync: { spreadsheetId: input } }) || input }, interaction.guildId);
    const sourceMessageId = interaction.customId.split(':')[1] || '';
    const updated = await updateSetupMessageFromModal(interaction, sourceMessageId);
    await interaction.reply({
      content: updated
        ? '✅ Google Sheet URL/ID saved. Setup wizard updated in-place.'
        : buildSetupSummary(getConfig()),
      ...(updated ? { flags: MessageFlags.Ephemeral } : { components: createSetupRows() })
    }).catch(() => null);
    return true;
  }

  if (interaction.customId === 'setup_sheet_mode') {
    await interaction.deferUpdate().catch(() => null);
    updateConfig('googleSync.enabled', true);
    const setupDraft = getSetupDraft(interaction.guildId);
    applySetupDraftToConfig(setupDraft);
    const config = getConfig();
    try {
      if (interaction.values[0] === 'fresh_config') {
        resetConfigFresh();
        saveDb({ events: {}, futureAvailability: {}, absenceTickets: {}, players: {}, meta: { postEventCoachReminders: {}, setupWizard: {} } });
        const freshConfig = getConfig();
        applySetupDraftToConfig(setupDraft);
        const result = await syncAllToSheet(freshConfig, loadDb(), { wipe: true, setupFreshWipe: true });
        await interaction.message?.edit(result.ok
          ? { content: `✅ Fresh config completed and sheet tabs rebuilt (\`${result.spreadsheetId}\`).\n\nWould you like to sync fixtures from Google Calendar now for the first time?`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_fresh_sync_yes').setLabel('Yes, sync fixtures now').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('setup_fresh_sync_no').setLabel('No, finish setup').setStyle(ButtonStyle.Secondary))] }
          : { content: 'Could not sync because spreadsheet ID is not configured.', components: createSetupRows() }).catch(() => null);
        return true;
      } else if (interaction.values[0] === 'load_backup') {
        const backupsTabAvailable = await hasBackupsTab(config).catch(() => false);
        if (!backupsTabAvailable) {
          await interaction.message?.edit({
            content: '⚠️ Could not load a backup because no **Backups** tab was found in the connected Google Sheet.\nPlease use **Fresh Config + Empty Sheets**.',
            components: createSetupModeRowsWithBackup(false)
          }).catch(() => null);
          return true;
        }
        const backups = (await loadSheetBackups(config).catch(() => [])).sort((a, b) => a.slot - b.slot);
        await interaction.message?.edit({
          content: 'Pick a backup slot to restore. You can press **Back** to choose Fresh Config instead.',
          components: createSetupBackupRows(backups)
        }).catch(() => null);
        return true;
      } else {
        await interaction.message?.edit({ content: 'Unknown setup action selected.', components: createSetupRows() }).catch(() => null);
      }
    } catch (error) {
      await interaction.message?.edit({ content: `❌ Setup sheet action failed: ${error.message}`, components: createSetupRows() }).catch(() => null);
    }

    return true;
  }

  if (interaction.customId === 'setup_restore_slot' && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const slot = Number.parseInt(interaction.values?.[0] || '0', 10);
    const config = getConfig();
    const backups = await loadSheetBackups(config).catch(() => []);
    const picked = backups.find((entry) => entry.slot === slot);
    if (!picked?.snapshot) {
      await interaction.message?.edit({ content: 'Selected slot is empty.', components: createSetupRows() }).catch(() => null);
      return true;
    }
    try {
      const parsed = JSON.parse(picked.snapshot);
      const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
      let lastProgressEdit = 0;
      await interaction.message?.edit({ content: buildSetupRestoreProgressText(slot, progressState), components: [] }).catch(() => null);
      await restoreSpreadsheetFromBackupSnapshot(config, parsed, (progress) => {
        progressState.percent = progress.percent;
        progressState.etaMs = progress.etaMs;
        progressState.currentTab = progress.currentTab;
        progressState.tabs = progress.tabs || [];
        const now = Date.now();
        if (now - lastProgressEdit >= 1500) {
          lastProgressEdit = now;
          interaction.message?.edit({ content: buildSetupRestoreProgressText(slot, progressState), components: [] }).catch(() => null);
        }
      });
      const restoredConfig = await loadConfigFromSheet(config).catch(() => null);
      if (restoredConfig) saveConfig(restoredConfig);
      progressState.percent = 100;
      await interaction.message?.edit({
        content: buildSetupRestoreProgressText(slot, progressState, true),
        components: createSetupFinishRow()
      }).catch(() => null);
    } catch (error) {
      await interaction.message?.edit({ content: `❌ Failed to restore slot ${slot}: ${error.message}`, components: createSetupRows() }).catch(() => null);
    }
    return true;
  }
  if ((interaction.customId === 'setup_fresh_sync_yes' || interaction.customId === 'setup_fresh_sync_no') && interaction.isButton()) {
    if (interaction.customId === 'setup_fresh_sync_no') {
      await interaction.update({
        content: '✅ Setup complete with fresh data.\nFirelands Bot is ready to use. Delete this message to finish setup.',
        components: createSetupFinishRow()
      }).catch(() => null);
      return true;
    }
    await interaction.update({ content: `${progressBar(15)} Syncing fixtures from Google Calendar...`, components: [] }).catch(() => null);
    try {
      await syncCalendarEvents();
      await interaction.message?.edit({
        content: `${progressBar(100)} ✅ Fixture sync completed.\nFirelands Bot setup is complete and ready to use. Delete this message to finish setup.`,
        components: createSetupFinishRow()
      }).catch(() => null);
    } catch (error) {
      await interaction.message?.edit({ content: `❌ Fixture sync failed: ${error.message}`, components: createSetupFinishRow() }).catch(() => null);
    }
    return true;
  }

  try {
    await interaction.deferUpdate();
  } catch (error) {
    if (error?.code === 10062) return true;
    throw error;
  }

  const config = getConfig();
  if (interaction.customId === 'setup_role_admin') {
    const roleId = interaction.values[0];
    saveSetupDraft({ adminRoleId: roleId }, interaction.guildId);
  }
  if (interaction.customId === 'setup_channel_admin') {
    const channelId = interaction.values[0];
    saveSetupDraft({ adminChannelId: channelId }, interaction.guildId);
  }

  await interaction.message?.edit({
    content: buildSetupSummary(getConfig()),
    components: createSetupRows()
  }).catch(() => null);
  return true;
}

function isWithinDays(dateValue, days) {
  const eventTime = new Date(dateValue).getTime();
  if (Number.isNaN(eventTime)) return false;
  const diff = eventTime - Date.now();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function getAttendanceChannelId(config, team) {
  return config.channels.teamChats?.[team] || config.channels.events || '';
}

function getAttendanceConfigIssue(config, team) {
  const progress = getTeamSetupProgress(config, team);
  if (progress.isComplete) return '';
  return `Team setup incomplete for ${team}. Missing: ${progress.missing.join(', ')}`;
}

async function warnMissingAttendanceConfig(team, issue) {
  const warningKey = `${team}:${issue}`;
  if (missingAttendanceConfigWarnings.has(warningKey)) return;
  missingAttendanceConfigWarnings.add(warningKey);
  await sendLog(`⚠️ Calendar sync skipped posting for **${team}**: ${issue}`);
}

function clearAttendanceWarning(team, issue) {
  const warningKey = `${team}:${issue}`;
  missingAttendanceConfigWarnings.delete(warningKey);
}

async function postEventMessage(event) {
  const config = getConfig();
  const eventsChannelId = getAttendanceChannelId(config, event.team);

  if (!eventsChannelId) {
    throw new Error('Events channel ID is not configured.');
  }

  const channel = await client.channels.fetch(eventsChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Events channel not found or not text based.');
  }

  const teamRoleId = config.roles[event.team]?.player;
  if (!teamRoleId || teamRoleId === 'ROLE_ID') {
    throw new Error(`Role ID not configured for team: ${event.team}`);
  }

  const attendingButton = new ButtonBuilder()
    .setCustomId(`attend_yes:${event.id}`)
    .setLabel('🟢 Attending')
    .setStyle(ButtonStyle.Success);

  const notAttendingButton = new ButtonBuilder()
    .setCustomId(`attend_no:${event.id}`)
    .setLabel('🔴 Not Attending')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(attendingButton, notAttendingButton);

  const message = await channel.send({
    content: [
      `<@&${teamRoleId}>`,
      `📅 ${event.title}`,
      `🕒 ${formatEventDate(event.date)}`,
      event.location ? `📍 ${event.location}` : null,
      'Please mark your availability now.'
    ].filter(Boolean).join('\n'),
    components: [row]
  });

  setEventMessageId(event.id, message.id);
  await sendLog(`📌 Posted event: **${event.title}** (${event.team})`);
}

async function syncCalendarEvents() {
  try {
    const config = getConfig();
    const teamMatchers = Object.fromEntries(
      Object.entries(config.teams || {}).map(([teamKey, meta]) => [
        teamKey,
        Array.isArray(meta?.eventNamePhrases) ? meta.eventNamePhrases : []
      ])
    );

    const calendarEvents = await fetchUpcomingEvents({
      calendarId: config.bot.calendarId || 'hello@firelandsunited.com',
      daysAhead: null,
      credentialsPath: config.bot.calendarCredentialsPath || '',
      teamMatchers
    });

    const db = loadDb();

    for (const event of calendarEvents) {
      const existingEvent = db.events[event.id];

      if (!existingEvent) {
        upsertEvent(event.id, {
          title: event.title,
          date: event.date,
          location: event.location || '',
          team: event.team,
          discordMessageId: '',
          responses: {}
        });
      } else {
        upsertEvent(event.id, {
          title: event.title,
          date: event.date,
          location: event.location || existingEvent.location || '',
          team: existingEvent.team || event.team
        });
      }

      const latestDb = loadDb();
      const syncedEvent = latestDb.events[event.id];

      if (!syncedEvent?.team || syncedEvent.discordMessageId) continue;
      if (!isWithinDays(syncedEvent.date, 14)) continue;

      const configIssue = getAttendanceConfigIssue(config, syncedEvent.team);
      if (configIssue) {
        await warnMissingAttendanceConfig(syncedEvent.team, configIssue);
        continue;
      }

      clearAttendanceWarning(syncedEvent.team, `Team setup incomplete for ${syncedEvent.team}. Missing: ${getTeamSetupProgress(config, syncedEvent.team).missing.join(', ')}`);

      await postEventMessage({ ...syncedEvent, id: event.id });
      console.log(`Posted new event: ${syncedEvent.title} (${event.id})`);
    }

    if (config.googleSync?.enabled && config.googleSync?.autoFullSync) {
      const latestDb = loadDb();
      await syncAllToSheet(config, latestDb);
    }
  } catch (error) {
    console.error('Calendar sync failed:', error);
    await sendLog(`❌ Calendar sync failed: ${error.message}`);
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (await handleSetupInteraction(interaction)) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.inGuild() && ['player', 'coach'].includes(interaction.commandName)) {
        const botCommandsChannelId = getConfig().channels?.botCommands;
        if (botCommandsChannelId && interaction.channelId !== botCommandsChannelId) {
          await interaction.reply({
            content: `Please use \`/${interaction.commandName}\` in <#${botCommandsChannelId}>.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }

      if (interaction.inGuild() && ['player', 'coach', 'attendance'].includes(interaction.commandName)) {
        let mode = interaction.commandName === 'coach' ? 'coach' : 'player';
        if (interaction.commandName === 'attendance') {
          mode = interaction.options.getSubcommand(false) === 'report' ? 'coach' : 'player';
        }
        const incompleteTeams = getIncompleteTeamsForMember(interaction.member, getConfig(), mode);
        if (incompleteTeams.length) {
          await interaction.reply({
            content: buildIncompleteTeamMessage(getConfig(), incompleteTeams),
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(interaction, { getConfig, sendLog });
      await logCommandUsage(interaction);
      return;
    }

    await interactionHandler.execute(interaction, { getConfig, sendLog });
  } catch (error) {
    console.error('Interaction handling failed:', formatInteractionError(error));
    const isAlreadyAcknowledged = error?.code === 40060 || /already been acknowledged/i.test(String(error?.message || ''));
    if (!isAlreadyAcknowledged) {
      await sendLog(`❌ Interaction failed: ${error.message}\n${summarizeInteractionContext(interaction)}`, interaction?.channelId);
    }

    const isUnknownInteraction = error?.code === 10062;
    if (!isAlreadyAcknowledged && !isUnknownInteraction && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: `Something went wrong. Error logged to the configured logs channel.\nReason: ${error.message}`, flags: MessageFlags.Ephemeral });
      } catch (replyError) {
        console.error('Failed to send interaction error reply:', replyError);
      }
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerSlashCommands();
  await syncCalendarEvents();
  for (const guild of client.guilds.cache.values()) {
    await postSetupWizardToGuild(guild);
  }

  cron.schedule('*/5 * * * *', async () => {
    await syncCalendarEvents();
  });

  startReminderJobs(client, getConfig);
});

client.on('guildCreate', async (guild) => {
  await postSetupWizardToGuild(guild);
});

client.login(TOKEN);
