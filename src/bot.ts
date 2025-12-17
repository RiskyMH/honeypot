import { Client, type API } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { APIChatInputApplicationCommandInteraction, APIApplicationCommandInteractionDataOption, GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import { InteractionType, GatewayDispatchEvents, GatewayIntentBits, ChannelType, MessageFlags } from "discord-api-types/v10";
import { initDb, getConfig, setConfig, logBanEvent, getBanCount, deleteConfig } from "./db";
import { registerCommands } from "./register-commands";
import { honeypotWarningMessage, honeypotUserDMMessage } from "./honeypot-warning-message";
import { addMessageToCache, deleteGuildFromMessages, deleteMessageFromCache, getRecentMessagesForUser } from "./cache-db";

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


async function postWarning(api: API, channelId: string, applicationId: string, bansCount = 0) {
  let messages = await api.channels.getMessages(channelId, { limit: 50 }).catch(() => []);
  const botMessages = messages.filter(m => m.author?.id === applicationId);
  let config = await getConfig(channelId).catch(() => null);
  const action = config?.action || 'ban';

  if (botMessages.length > 0) {
    const [first, ...rest] = botMessages;
    if (!first) {
      const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(bansCount, action));
      return msg.id;
    }
    try {
      await api.channels.editMessage(channelId, first.id, honeypotWarningMessage(bansCount, action));
      await Promise.allSettled(rest.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
      return first.id;
    } catch (err) {
      const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(bansCount, action));
      await Promise.allSettled(botMessages.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
      return msg.id;
    }
  } else {
    const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(bansCount, action));
    return msg.id;
  }
}

client.on(GatewayDispatchEvents.GuildDelete, async ({ data: guild, api }) => {
  try {
    await deleteConfig(guild.id);
    await deleteGuildFromMessages(guild.id);
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
      const bansCount = config ? await getBanCount(guild.id) : 0;
      msgId = config?.honeypot_msg_id || await postWarning(api, channelId, applicationId!, bansCount);
      setupSuccess = true;
    } catch (err) {
      console.error(`Failed to create/send honeypot message: ${err}`);
    }
    await setConfig({
      guild_id: guild.id,
      honeypot_channel_id: channelId ?? "",
      honeypot_msg_id: msgId,
      admin_channel_id: config?.admin_channel_id ?? null,
      action: config?.action ?? 'ban',
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


async function deleteRecentUserMessagesFromAllChannels(api: API, guildId: string, userId: string) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const cachedMessages = await getRecentMessagesForUser(guildId, userId, oneHourAgo);

  const channelMap = new Map<string, string[]>();
  for (const msg of cachedMessages) {
    if (!channelMap.has(msg.channel_id)) channelMap.set(msg.channel_id, []);
    channelMap.get(msg.channel_id)!.push(msg.message_id);
  }
  for (const [channelId, ids] of channelMap.entries()) {
    try {
      if (ids.length === 1 && ids[0]) {
        await api.channels.deleteMessage(channelId, ids[0], { reason: "Honeypot triggered (deleting last 1hr of messages)" });
      } else if (ids.length > 1) {
        await api.channels.bulkDeleteMessages(channelId, ids, { reason: "Honeypot triggered (deleting last 1hr of messages)" });
      }
    } catch (err) {
      // Ignore errors (e.g., missing permissions, channel deleted, etc.)
    }
  }
}

client.on(GatewayDispatchEvents.MessageDelete, async ({ data: message, api }) => deleteMessageFromCache(message.id));

client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message, api }) => {
  try {
    if (!message.guild_id || message.author.bot) return;

    const config = await getConfig(message.guild_id);
    if (!config || !config.action || config.action === 'disabled') {
      return;
    }

    if (["kick", "timeout"].includes(config.action)) {
      await addMessageToCache({
        guild_id: message.guild_id,
        channel_id: message.channel_id,
        message_id: message.id,
        user_id: message.author.id,
        timestamp: new Date(message.timestamp).getTime(),
      });
    }

    if (message.channel_id !== config.honeypot_channel_id) {
      return;
    }

    let actionText = config.action === 'ban' ? 'banned' : config.action === 'timeout' ? 'timed out for 24 hours' : 'kicked';

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
          { reason: "Triggered honeypot" }
        );
      } else if (config.action === 'timeout' || config.action === 'kick') {
        // Timeout: mute for 24h, Kick: remove from server
        // Both: delete last 1 hour of messages
        if (config.action === 'timeout') {
          const oneDayFromNow = Date.now() + 24 * 60 * 60 * 1000;
          await api.guilds.editMember(message.guild_id, message.author.id, {
            communication_disabled_until: new Date(oneDayFromNow).toISOString(),
          }, {
            reason: "Triggered honeypot"
          });
        } else if (config.action === 'kick') {
          await api.guilds.removeMember(message.guild_id, message.author.id, { reason: "Triggered honeypot" });
        }
        await Bun.sleep(1000); // slight delay to ensure all messages are present
        await deleteRecentUserMessagesFromAllChannels(api, message.guild_id, message.author.id);
      } else {
        console.error("Unknown action in honeypot config:", config.action);
      }
    } catch (err) {
      failed = true;
    }
    await logBanEvent(message.guild_id, message.author.id);

    if (config.honeypot_msg_id) try {
      const bansCount = await getBanCount(message.guild_id);
      await api.channels.editMessage(
        config.honeypot_channel_id,
        config.honeypot_msg_id,
        honeypotWarningMessage(bansCount, config.action)
      );
    } catch (err) { console.error(`Failed to update honeypot message: ${err}`); }

    if (config.admin_channel_id && !failed) {
      const actionText = {
        ban: 'banned',
        timeout: 'timed out',
        kick: 'kicked',
        disabled: 'disabled'
      }[config.action] || 'banned';
      await api.channels.createMessage(config.admin_channel_id, {
        content: `User <@${message.author.id}> was ${actionText} for triggering the honeypot in <#${config.honeypot_channel_id}>.`,
        allowed_mentions: {}
      });
    } else if (failed) {
      const roleReqs = {
        ban: "`Ban Members` permission",
        timeout: "`Moderate Members` & `Manage Messages` permission",
        kick: "`Kick Members` & `Manage Messages` permission",
      }[config.action] || "appropriate permissions";
      await api.channels.createMessage(config.admin_channel_id || config.honeypot_channel_id, {
        content: `⚠️ User <@${message.author.id}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# Please check my permissions to ensure I have ${roleReqs} and my role higher than the member's highest role.`,
        allowed_mentions: {}
      });
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
    const originalAdminChannelId = config?.admin_channel_id;
    if (!config) {
      config = {
        guild_id: guildId,
        honeypot_channel_id: "",
        honeypot_msg_id: null,
        admin_channel_id: null,
        action: 'ban',
      };
    }
    let updated = false;

    const options = (interaction.data as APIChatInputApplicationCommandInteraction["data"]).options as APIApplicationCommandInteractionDataOption[] | undefined;
    for (const opt of options ?? []) {
      if (opt.name === "channel" && "value" in opt && opt.value) {
        config.honeypot_channel_id = opt.value as string;
        updated = true;
      }
      if (opt.name === "admin_channel" && "value" in opt && opt.value) {
        config.admin_channel_id = opt.value as string;
        updated = true;
      }
      if (opt.name === "action" && "value" in opt) {
        if (typeof opt.value === "string" && ["ban", "timeout", "disabled", "kick"].includes(opt.value)) {
          config.action = opt.value as any;
        } else {
          config.action = 'ban';
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
        const count = await getBanCount(guildId);
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
        const count = await getBanCount(guildId);
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

      if (config.admin_channel_id !== originalAdminChannelId && config.admin_channel_id) {
        try {
          await api.channels.createMessage(config.admin_channel_id, {
            content: `Honeypot is set up in <#${config.honeypot_channel_id}>!`,
            allowed_mentions: {}
          });
        } catch {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: "There was a problem sending test message to the admin channel. Please check my permissions and try again.",
            allowed_mentions: {}
          });
          return;
        }
      }
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `Honeypot config updated!\n-# * Channel: <#${config.honeypot_channel_id}>\n-# * Admin Channel: ${config.admin_channel_id ? `<#${config.admin_channel_id}>` : '*(Not set)*'}\n-# * Action: ${config.action}`,
        allowed_mentions: {}
      });
    } else {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `No changes made.\n-# * Channel: <#${config.honeypot_channel_id}>\n-# * Admin Channel: ${config.admin_channel_id ? `<#${config.admin_channel_id}>` : '*(Not set)*'}\n-# * Action: ${config.action}`,
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
});

gateway.connect();
