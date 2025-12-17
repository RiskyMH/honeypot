import { Client, type API } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { APIChatInputApplicationCommandInteraction, APIApplicationCommandInteractionDataOption, GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import { InteractionType, GatewayDispatchEvents, GatewayIntentBits, ChannelType, MessageFlags, GatewayOpcodes, PresenceUpdateStatus, ActivityType } from "discord-api-types/v10";
import { initDb, getConfig, setConfig, logModerateEvent, getModeratedCount, deleteConfig } from "./db";
import { registerCommands } from "./register-commands";
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
          { reason: "Triggered honeypot -> kick" }
        );
        await api.guilds.unbanUser(
          message.guild_id,
          message.author.id,
          { reason: "Triggered honeypot -> kick" }
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
          kick: "`Ban Members` permission (to ban & unban)",
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
  try {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    if (interaction.data.name !== "honeypot") return;
    const guildId = (interaction as APIChatInputApplicationCommandInteraction).guild_id;
    if (!guildId) return;

    let config = await getConfig(guildId);
    const originalChannelId = config?.honeypot_channel_id;
    const originalLogChannelId = config?.log_channel_id;
    if (!config) {
      config = {
        guild_id: guildId,
        honeypot_channel_id: "",
        honeypot_msg_id: null,
        log_channel_id: null,
        action: 'kick',
      };
    }
    let updated = false;

    const options = (interaction.data as APIChatInputApplicationCommandInteraction["data"]).options as APIApplicationCommandInteractionDataOption[] | undefined;
    for (const opt of options ?? []) {
      if (opt.name === "channel" && "value" in opt && opt.value) {
        config.honeypot_channel_id = opt.value as string;
        updated = true;
      }
      if (opt.name === "log_channel" && "value" in opt && opt.value) {
        config.log_channel_id = opt.value as string;
        updated = true;
      }
      if (opt.name === "action" && "value" in opt) {
        if (typeof opt.value === "string" && ["ban", "disabled", "kick"].includes(opt.value)) {
          config.action = opt.value as any;
        } else {
          config.action = 'kick';
        }
        updated = true;
      }
    }

    let currentHoneypotMsgIsValid = false;
    if (config.honeypot_msg_id) {
      const msg = await api.channels.getMessage(config.honeypot_channel_id, config.honeypot_msg_id).catch(() => null);
      if (msg?.id) {
        currentHoneypotMsgIsValid = true;
      }
    }

    if (updated) {
      if (config.honeypot_channel_id !== originalChannelId || currentHoneypotMsgIsValid === false) {
        const count = await getModeratedCount(guildId);
        try {
          const msg = await api.channels.createMessage(
            config.honeypot_channel_id,
            honeypotWarningMessage(count, config.action)
          );
          config.honeypot_msg_id = msg.id;
        } catch (err) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: "There was a problem setting up the honeypot channel. Please check my permissions and try again.",
            allowed_mentions: {}
          });
          return;
        }
      } else if (config.honeypot_msg_id) {
        const count = await getModeratedCount(guildId);
        try {
          await api.channels.editMessage(
            config.honeypot_channel_id,
            config.honeypot_msg_id,
            honeypotWarningMessage(count, config.action)
          );
        } catch (err) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: "There was a problem setting up the honeypot channel. Please check my permissions and try again.",
            allowed_mentions: {}
          });
          return;
        }
      }

      if (config.log_channel_id !== originalLogChannelId && config.log_channel_id) {
        try {
          await api.channels.createMessage(config.log_channel_id, {
            content: `Honeypot is set up in <#${config.honeypot_channel_id}>! This channel will log honeypot events.`,
            allowed_mentions: {}
          });
        } catch {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: "There was a problem sending test message to the log channel. Please check my permissions and try again.",
            allowed_mentions: {}
          });
          return;
        }
      }
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `Honeypot config updated!\n-# * Channel: <#${config.honeypot_channel_id}>\n-# * Log Channel: ${config.log_channel_id ? `<#${config.log_channel_id}>` : '*(Not set)*'}\n-# * Action: ${config.action}`,
        allowed_mentions: {}
      });
    } else {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `No changes made.\n-# * Channel: <#${config.honeypot_channel_id}>\n-# * Log Channel: ${config.log_channel_id ? `<#${config.log_channel_id}>` : '*(Not set)*'}\n-# * Action: ${config.action}`,
        flags: MessageFlags.Ephemeral,
        allowed_mentions: {}
      });
    }
    await setConfig(config);
  } catch (err) {
    console.error(`Error with InteractionCreate handler: ${err}`);
  }
});

client.once(GatewayDispatchEvents.Ready, (c) => {
  console.log(`${c.data.user.username}#${c.data.user.discriminator} is ready!`);
  applicationId = c.data.user.id;

  registerCommands(c.api, c.data.user.id);

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
