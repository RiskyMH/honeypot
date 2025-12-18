import { Client, type API } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { APIModalInteractionResponseCallbackData, GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import { InteractionType, GatewayDispatchEvents, GatewayIntentBits, ChannelType, MessageFlags, GatewayOpcodes, PresenceUpdateStatus, ActivityType, ComponentType, SelectMenuDefaultValueType, ApplicationCommandType, ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from "discord-api-types/v10";
import { initDb, getConfig, setConfig, logModerateEvent, getModeratedCount, deleteConfig, type HoneypotConfig } from "./db";
import { honeypotWarningMessage, honeypotUserDMMessage } from "./honeypot-warning-message";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
let applicationId = atob(process.env.DISCORD_TOKEN?.split(".")[0]!); // i bet most didn't know this fact about discord tokens

await initDb();

const EMOJI = "🍯";
const CUSTOM_EMOJI_ID = "1450060724943720600";
const CUSTOM_EMOJI = `<:honeypot:${CUSTOM_EMOJI_ID}>`;

process.on('uncaughtException', (err) => {
  console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

const rest = new REST({ version: "10" }).setToken(token);
const gateway = new WebSocketManager({
  token,
  intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
  rest,
});

const client = new Client({ rest, gateway });

async function findOrCreateHoneypotChannel(api: API, guild: GatewayGuildCreateDispatchData): Promise<string> {
  const channels = await api.guilds.getChannels(guild.id);
  const channel = channels.find((c: any) => c.name === "honeypot" && c.type === ChannelType.GuildText);
  if (channel) return channel.id;

  const newChannel = await api.guilds.createChannel(guild.id, {
    name: "honeypot",
    type: ChannelType.GuildText,
    position: channels.length + 1,
  }, {
    reason: "Honeypot channel for bot",
  });
  return newChannel.id;
}


async function postWarning(api: API, channelId: string, applicationId: string, moderatedCount = 0) {
  const messages = await api.channels.getMessages(channelId, { limit: 100 }).catch(() => []);
  const botMessages = messages.filter(m => m.author?.id === applicationId);
  let config = await getConfig(channelId).catch(() => null);
  const action = config?.action || 'kick';

  if (botMessages.length > 0) {
    const [first, ...rest] = botMessages;
    if (!first) {
      const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
      return msg.id;
    }
    try {
      await api.channels.editMessage(channelId, first.id, honeypotWarningMessage(moderatedCount, action));
      await Promise.allSettled(rest.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
      return first.id;
    } catch (err) {
      const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
      await Promise.allSettled(botMessages.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
      return msg.id;
    }
  } else {
    const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
    return msg.id;
  }
}

client.on(GatewayDispatchEvents.GuildDelete, async ({ data: guild, api }) => {
  try {
    await deleteConfig(guild.id);
  } catch (err) {
    console.error(`Failed to delete honeypot config for guild ${guild.id}:`, err);
  }
});

client.on(GatewayDispatchEvents.GuildCreate, async ({ data: guild, api }) => {
  try {
    let config = await getConfig(guild.id);
    if (config?.action === "disabled") return;

    let channelId = config?.honeypot_channel_id;
    let msgId: string | null = null;
    let setupSuccess = false;
    try {
      if (!channelId) {
        channelId = await findOrCreateHoneypotChannel(api, guild);
      }
      const moderatedCount = config ? await getModeratedCount(guild.id) : 0;
      msgId = config?.honeypot_msg_id || await postWarning(api, channelId, applicationId!, moderatedCount);
      setupSuccess = true;
    } catch (err) {
      console.error(`Failed to create/send honeypot message: ${err}`);
    }
    await setConfig({
      guild_id: guild.id,
      honeypot_channel_id: channelId ?? "",
      honeypot_msg_id: msgId,
      log_channel_id: config?.log_channel_id ?? null,
      action: config?.action ?? 'kick',
    });
    if (!setupSuccess && !config && guild.system_channel_id) {
      try {
        await api.channels.createMessage(guild.system_channel_id, {
          content: `👋 Thanks for adding the honeypot bot! Please run /honeypot to finish setup.\n-# The bot couldn't create or send the warning message automatically.`,
          allowed_mentions: {}
        });
      } catch (err) {
        console.error(`Failed to send welcome/setup message: ${err}`);
      }
    }
  } catch (err) {
    console.error(`Error with GuildCreate handler: ${err}`);
  }
});

client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message, api }) => {
  try {
    if (!message.guild_id || message.author.bot) return;

    const config = await getConfig(message.guild_id);
    if (!config || !config.action) return;
    if (message.channel_id !== config.honeypot_channel_id) return;

    // just for the fun of it to acknowledge it saw the message
    api.channels.addMessageReaction(
      message.channel_id,
      message.id,
      `honeypot:${CUSTOM_EMOJI_ID}`
    ).catch(() => null);

    if (config.action === 'disabled') return;

    const actionText = {
      ban: 'banned',
      kick: 'kicked',
      disabled: '???it is disabled???'
    }[config.action] || '???unknown action???';

    // should DM user first before banning so that discord has less reason to block it
    try {
      let guildName = `this server`;
      const guild = await api.guilds.get(message.guild_id).catch(() => null);
      if (guild && guild.name) guildName = `**${guild.name}**`;
      const link = `https://discord.com/channels/${message.guild_id}/${message.channel_id}/${message.id}`;
      const dmContent = honeypotUserDMMessage(actionText, guildName, config.action, link);
      await api.users.createDM(message.author.id).then((dm) =>
        api.channels.createMessage(dm.id, dmContent)
      );
    } catch { /* Ignore DM errors (user has DMs closed, etc.) */ }

    let failed = false;
    try {
      if (config.action === 'ban') {
        // Ban: permanent ban, delete last 1 hour of messages
        await api.guilds.banUser(
          message.guild_id,
          message.author.id,
          { delete_message_seconds: 3600 },
          { reason: "Triggered honeypot -> ban" }
        );
      } else if (config.action === 'kick') {
        // Kick: kick but via ban/unban, delete last 1 hour of messages
        await api.guilds.banUser(
          message.guild_id,
          message.author.id,
          { delete_message_seconds: 3600 },
          { reason: "Triggered honeypot -> softban (kick)" }
        );
        await api.guilds.unbanUser(
          message.guild_id,
          message.author.id,
          { reason: "Triggered honeypot -> softban (kick)" }
        );
      } else {
        console.error("Unknown action in honeypot config:", config.action);
      }
    } catch (err) {
      failed = true;
    }
    await logModerateEvent(message.guild_id, message.author.id);

    if (config.honeypot_msg_id) try {
      const moderatedCount = await getModeratedCount(message.guild_id);
      await api.channels.editMessage(
        config.honeypot_channel_id,
        config.honeypot_msg_id,
        honeypotWarningMessage(moderatedCount, config.action)
      );
    } catch (err) { console.error(`Failed to update honeypot message: ${err}`); }

    try {
      if (config.log_channel_id && !failed) {
        await api.channels.createMessage(config.log_channel_id, {
          content: `User <@${message.author.id}> was ${actionText} for triggering the honeypot in <#${config.honeypot_channel_id}>.`,
          allowed_mentions: {}
        });
      } else if (failed) {
        const roleReqs = {
          ban: "`Ban Members` permission",
          kick: "`Ban Members` permission (to softban)",
        }[config.action] || "appropriate permissions";
        await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id, {
          content: `⚠️ User <@${message.author.id}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# Please check my permissions to ensure I have ${roleReqs} and that my role higher than their highest role.`,
          allowed_mentions: {},
        });
      }
    } catch (err) {
      // somewhat chance the channel is deleted or the bot lost perms to send messages there
      console.error(`Failed to send log message (MessageCreate handler): ${err}`);
    }
  } catch (err) {
    console.error(`Error with MessageCreate handler: ${err}`);
  }
});

client.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, api }) => {
  const guildId = interaction.guild_id;
  if (!guildId) return;

  try {
    // slash command handler: show modal
    if (interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot") {
      let config = await getConfig(guildId);
      if (!config) {
        config = {
          guild_id: guildId,
          honeypot_channel_id: "",
          honeypot_msg_id: null,
          log_channel_id: null,
          action: 'kick',
        };
      }

      const modal: APIModalInteractionResponseCallbackData = {
        title: "Honeypot",
        custom_id: `honeypot_config_modal`,
        components: [
          {
            type: ComponentType.Label,
            label: "Honeypot Channel",
            description: "Any message sent in this channel will cause the author to be kicked/banned from server",
            component: {
              type: ComponentType.ChannelSelect,
              custom_id: "honeypot_channel",
              min_values: 1,
              max_values: 1,
              placeholder: "#honeypot",
              channel_types: [ChannelType.GuildText],
              default_values: config.honeypot_channel_id ? [{ id: config.honeypot_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
              required: true,
            }
          },
          {
            type: ComponentType.Label,
            label: "Log Channel",
            description: "The channel to log events (ie kicks/bans that the bot actioned)",
            component: {
              type: ComponentType.ChannelSelect,
              custom_id: "log_channel",
              min_values: 0,
              max_values: 1,
              placeholder: "#mod-log",
              channel_types: [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread],
              default_values: config.log_channel_id ? [{ id: config.log_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
              required: false,
            }
          },
          {
            type: ComponentType.Label,
            label: "Action",
            description: "What should the bot do to message author?",
            component: {
              type: ComponentType.StringSelect,
              custom_id: "honeypot_action",
              placeholder: "Softban (kick)",
              options: [
                { label: "Softban (kick)", value: "kick", description: "Bans & unbans to delete last 1hr of messages", default: config.action === "kick" },
                { label: "Ban", value: "ban", description: "Permanently bans the user to also delete last 1hr of messages", default: config.action === "ban" },
                { label: "Disabled", value: "disabled", description: "Don't do anything", default: config.action === "disabled" }
              ],
              min_values: 1,
              max_values: 1,
              required: true,
            }
          }
        ]
      };
      await api.interactions.createModal(interaction.id, interaction.token, modal);
      return;
    }

    // modal submit handler: update config from modal values
    else if (interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_config_modal`) {
      const newConfig: HoneypotConfig = {
        guild_id: guildId,
        honeypot_channel_id: "",
        honeypot_msg_id: null,
        log_channel_id: null,
        action: 'kick',
      }

      for (const label of interaction.data.components) {
        const c = (label as any).component ?? label;
        if (!c) continue;
        if (c.custom_id === "honeypot_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.honeypot_channel_id = c.values[0];
        if (c.custom_id === "log_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.log_channel_id = c.values[0];
        if (c.custom_id === "honeypot_action" && Array.isArray(c.values) && c.values.length > 0) {
          if (["kick", "ban", "disabled"].includes(c.values[0])) newConfig.action = c.values[0] as any;
        }
      }

      const prevConfig = await getConfig(guildId);
      const honeypotChanged = newConfig.honeypot_channel_id !== prevConfig?.honeypot_channel_id;
      const logChanged = newConfig.log_channel_id !== prevConfig?.log_channel_id;

      // if honeypot channel changed or current honeypot msg is invalid, create new honeypot message
      // otherwise try to edit it with latest data
      // but if either fail, then let user know its broken sadly
      let msgId: string | null = null;
      try {
        const count = await getModeratedCount(guildId);
        const messageBody = honeypotWarningMessage(count, newConfig.action);
        if (honeypotChanged) {
          const msg = await api.channels.createMessage(
            newConfig.honeypot_channel_id,
            messageBody
          );
          msgId = msg.id;
        } else if (prevConfig?.honeypot_msg_id) {
          try {
            await api.channels.editMessage(
              newConfig.honeypot_channel_id,
              prevConfig.honeypot_msg_id,
              messageBody
            );
          } catch {
            const msg = await api.channels.createMessage(
              newConfig.honeypot_channel_id,
              messageBody
            );
            msgId = msg.id;
          }
        } else {
          console.error("No previous honeypot message ID found to edit.");
        }
      } catch (err) {
        await api.interactions.reply(interaction.id, interaction.token, {
          content: `There was a problem setting up the honeypot channel to <#${newConfig.honeypot_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
          allowed_mentions: {},
          flags: MessageFlags.Ephemeral,
        });
        return;
      }


      if (logChanged && newConfig.log_channel_id) {
        try {
          await api.channels.createMessage(newConfig.log_channel_id, {
            content: `Honeypot is set up in <#${newConfig.honeypot_channel_id}>! This current channel will log honeypot events.`,
            allowed_mentions: {},
          });
        } catch {
          // clean up just created honeypot message if log channel fails (because user might think it's fully set up otherwise)
          if (msgId) {
            await api.channels.deleteMessage(newConfig.honeypot_channel_id, msgId, { reason: "Cleaning up honeypot message after log channel setup failure" }).catch(() => null);
          }

          await api.interactions.reply(interaction.id, interaction.token, {
            content: `There was a problem sending test message to the log channel <#${newConfig.log_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
            flags: MessageFlags.Ephemeral,
            allowed_mentions: {},
          });
          return;
        }
      }

      if (msgId && prevConfig?.honeypot_msg_id) {
        await api.channels.deleteMessage(
          prevConfig.honeypot_channel_id,
          prevConfig.honeypot_msg_id,
          { reason: "Honeypot channel changed, so cleaning up old honeypot message" }
        ).catch(() => null);
      }

      await setConfig({
        ...(prevConfig || {}),
        ...newConfig,
        honeypot_msg_id: msgId || newConfig.honeypot_msg_id || prevConfig?.honeypot_msg_id || null,
      });
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `Honeypot config updated!\n-# - Channel: <#${newConfig.honeypot_channel_id}>\n-# - Log Channel: ${newConfig.log_channel_id ? `<#${newConfig.log_channel_id}>` : '*(Not set)*'}\n-# - Action: ${newConfig.action}`,
        allowed_mentions: {},
      });
      return;
    }

    return;
  } catch (err) {
    console.error("Error with InteractionCreate handler:", err);
  }
});


client.once(GatewayDispatchEvents.Ready, (c) => {
  console.log(`${c.data.user.username}#${c.data.user.discriminator} is ready!`);
  applicationId = c.data.user.id;

  c.api.applicationCommands.bulkOverwriteGlobalCommands(c.data.user.id, [
    {
      // this command opens a modal for configuring the honeypot
      name: "honeypot",
      description: "Configure honeypot settings",
      type: ApplicationCommandType.ChatInput,
      options: [],
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild],
    },
  ]);

  client.gateway.send(c.shardId, {
    op: GatewayOpcodes.PresenceUpdate,
    d: {
      since: null,
      activities: [
        {
          name: "#honeypot",
          state: "Watching #honeypot for bots",
          type: ActivityType.Custom,
        }
      ],
      status: PresenceUpdateStatus.Online,
      afk: false,
    }
  });

});

gateway.connect();
