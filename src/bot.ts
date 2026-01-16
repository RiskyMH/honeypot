import { Client, type API } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { APIMessage, APIModalInteractionResponseCallbackData, GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import { InteractionType, GatewayDispatchEvents, GatewayIntentBits, ChannelType, MessageFlags, GatewayOpcodes, PresenceUpdateStatus, ActivityType, ComponentType, SelectMenuDefaultValueType, ApplicationCommandType, ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, ButtonStyle } from "discord-api-types/v10";
import { initDb, getConfig, setConfig, logModerateEvent, getModeratedCount, deleteConfig, type HoneypotConfig, unsetHoneypotChannel, unsetLogChannel, unsetHoneypotMsg, getStats, getUserModeratedCount, getGuildsWithExperiment } from "./db";
import { honeypotWarningMessage, honeypotUserDMMessage } from "./honeypot-warning-message";
import randomChannelNames from "./random-channel-names.yaml";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
let applicationId = atob(process.env.DISCORD_TOKEN?.split(".")[0]!); // i bet most didn’t know this fact about discord tokens

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
  shardCount: null,
  initialPresence: {
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
  },
});

const client = new Client({ rest, gateway });

const hasPermission = (permissions: bigint, permission: bigint) => (permissions & permission) === permission;

async function findOrCreateHoneypotChannel(api: API, guild: GatewayGuildCreateDispatchData): Promise<string> {
  const channel = guild.channels.find((c) => c.name === "honeypot" && c.type === ChannelType.GuildText);
  if (channel) return channel.id;

  const newChannel = await api.guilds.createChannel(guild.id, {
    name: "honeypot",
    type: ChannelType.GuildText,
    position: guild.channels.length + 1,
  }, {
    reason: "Honeypot channel for bot",
  });
  return newChannel.id;
}


async function postWarning(api: API, channelId: string, applicationId: string, moderatedCount = 0) {
  const messages = await api.channels.getMessages(channelId, { limit: 100 }).catch(() => []);
  const botMessages = messages.filter(m => m.author?.id === applicationId);
  let config = await getConfig(channelId).catch(() => null);
  const action = config?.action || 'softban';

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
    if (guild.unavailable === true) return;
    await deleteConfig(guild.id);
    guildCache.delete(guild.id);
  } catch (err) {
    console.error(`Failed to delete honeypot config for guild ${guild.id}:`, err);
  }
});

client.on(GatewayDispatchEvents.GuildUpdate, async ({ data: guild, api }) => {
  guildCache.set(guild.id, { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code });
});

client.on(GatewayDispatchEvents.GuildCreate, async ({ data: guild, api }) => {
  try {
    guildCache.set(guild.id, { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code });

    let config = await getConfig(guild.id);
    if (config?.action === "disabled" || config) return;

    let channelId = null as null | string;
    let msgId = null as null | string;
    let setupSuccess = false;
    try {
      channelId ||= await findOrCreateHoneypotChannel(api, guild);
      msgId ||= await postWarning(api, channelId, applicationId!, await getModeratedCount(guild.id));
      setupSuccess = true;
    } catch (err) {
      console.error(`Failed to create/send honeypot message: ${err}`);
    }
    await setConfig({
      guild_id: guild.id,
      honeypot_channel_id: channelId,
      honeypot_msg_id: msgId,
      log_channel_id: null,
      action: 'softban',
      experiments: [],
    });
    if (!setupSuccess && !config && guild.system_channel_id) {
      try {
        await api.channels.createMessage(guild.system_channel_id, {
          content: `👋 Thanks for adding the honeypot bot! Please run /honeypot to finish setup.\n-# The bot couldn’t create or send the warning message automatically.`,
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

client.on(GatewayDispatchEvents.ChannelDelete, async ({ data: channel, api }) => {
  if (!channel.guild_id) return;
  try {
    await unsetHoneypotChannel(channel.guild_id, channel.id);
    await unsetLogChannel(channel.guild_id, channel.id);
  } catch (err) {
    console.error(`Error with ChannelDelete handler: ${err}`);
  }
});

client.on(GatewayDispatchEvents.MessageDelete, async ({ data: message, api }) => {
  if (!message.guild_id) return;
  try {
    await unsetHoneypotMsg(message.guild_id, message.id);
  } catch (err) {
    console.error(`Error with MessageDelete handler: ${err}`);
  }
});

client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message, api }) => {
  if (!message.guild_id) return;
  if (message.interaction_metadata && message.author.id !== applicationId) {
    return await onMessage({
      userId: message.interaction_metadata.user.id,
      channelId: message.channel_id,
      guildId: message.guild_id,
      messageId: message.id
    }, api);
  }

  if (message.author.bot) return;
  return await onMessage({
    userId: message.author.id,
    channelId: message.channel_id,
    guildId: message.guild_id,
    messageId: message.id
  }, api);
});

// // looks like threads create a message event anyway, so no need to handle separately
// client.on(GatewayDispatchEvents.ThreadCreate, async ({ data: thread, api }) => {
//   if (!thread.guild_id || thread.owner_id === applicationId || !thread.owner_id || !thread.parent_id) return;
//   await onMessage({
//     userId: thread.owner_id,
//     channelId: thread.parent_id,
//     guildId: thread.guild_id,
//     threadId: thread.id
//   }, api);
// });

const guildCache = new Map<string, { name: string, ownerId: string, vanityInviteCode: string | null }>();
const getGuildInfo = async (api: API, guildId: string, signal?: AbortSignal) => {
  if (guildCache.has(guildId)) return guildCache.get(guildId)!;
  const guild = await api.guilds.get(guildId, { signal });
  const info = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || null };
  guildCache.set(guildId, info);
  return info;
};

const onMessage = async ({ userId, channelId, guildId, messageId, threadId }: { userId: string, channelId: string, guildId: string, messageId?: string, threadId?: string }, api: API) => {
  try {
    const config = await getConfig(guildId);
    if (!config || !config.action) return;
    if (channelId !== config.honeypot_channel_id) return;

    // just for the fun of it to acknowledge it saw the message
    let emojiReact = null as null | Promise<any>
    if (messageId) emojiReact = api.channels.addMessageReaction(
      channelId,
      messageId,
      `honeypot:${CUSTOM_EMOJI_ID}`,
      // this really doesn’t matter, so lets not have it get stuck in ratelimit queue if bot gets enough usage
      { signal: AbortSignal.timeout(500) }
    ).catch(() => null);

    if (config.action === 'disabled') return;

    const actionText = {
      ban: 'banned',
      kick: 'kicked',
      softban: 'kicked',
      disabled: '???it is disabled???'
    }[config.action] || '???unknown action???';

    // should DM user first before banning so that discord has less reason to block it
    let dmMessage: APIMessage | null = null;
    let isOwner = false;
    try {
      const timeout = AbortSignal.timeout(1500);
      let guildName = `this server`;
      let guild = await getGuildInfo(api, guildId, timeout).catch(() => null);
      if (guild) {
        guildName = `**${guild.name}**`;
        if (guild.vanityInviteCode) guildName = `[${guildName}](https://discord.gg/${guild.vanityInviteCode})`;
        if (guild.ownerId === userId) isOwner = true;
      }
      if (!config.experiments.includes("no-dm")) {
        const link = `https://discord.com/channels/${guildId}/${channelId}/${config.honeypot_msg_id || messageId || ""}`;
        const dmContent = honeypotUserDMMessage(actionText, guildName, config.action, link, isOwner);
        const { id: dmChannel } = await api.users.createDM(userId, { signal: timeout });
        dmMessage = await api.channels.createMessage(dmChannel, dmContent, { signal: timeout })
      }
    } catch (err) {
      /* Ignore DM errors (user has DMs closed, etc.) */
      console.log(`Failed to send DM to user: ${err}`)
    }

    let failed = false;
    if (!isOwner) try {
      if (config.action === 'ban') {
        // Ban: permanent ban, delete last 1 hour of messages
        await api.guilds.banUser(
          guildId,
          userId,
          { delete_message_seconds: 3600 },
          { reason: "Triggered honeypot -> ban" }
        );
      } else if (config.action === 'softban' || config.action === 'kick') {
        // Kick: kick but via ban/unban, delete last 1 hour of messages
        await api.guilds.banUser(
          guildId,
          userId,
          { delete_message_seconds: 3600 },
          { reason: "Triggered honeypot -> softban (kick)" }
        );
        // maybe discord needs time to yeet their messages?
        await Bun.sleep(10_000)
        await api.guilds.unbanUser(
          guildId,
          userId,
          { reason: "Triggered honeypot -> softban (kick)" }
        );
      } else {
        console.error("Unknown action in honeypot config:", config.action);
      }
    } catch (err) {
      console.log(`Failed to ${config.action} user: ${err}`);
      failed = true;
    } else {
      // server owner cannot be banned/kicked by anyone
      failed = false
    };
    if (!failed && !isOwner) await logModerateEvent(guildId, userId);

    if (config.honeypot_msg_id && !config.experiments.includes("no-warning-msg")) try {
      const moderatedCount = await getModeratedCount(guildId);
      await api.channels.editMessage(
        config.honeypot_channel_id,
        config.honeypot_msg_id,
        honeypotWarningMessage(moderatedCount, config.action)
      );
    } catch (err) { console.error(`Failed to update honeypot message: ${err}`); }

    try {
      if (config.log_channel_id && !failed && !isOwner) {
        await api.channels.createMessage(config.log_channel_id, {
          content: `User <@${userId}> was ${actionText} for triggering the honeypot in <#${config.honeypot_channel_id}>.`,
          allowed_mentions: {}
        });
      } else if (isOwner && !config.experiments.includes("no-warning-msg")) {
        await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id, {
          content: `⚠️ User <@${userId}> triggered the honeypot, but they are the **server owner** so I cannot ${config.action} them.\n-# In anycase **ensure my role is higher** than people’s highest role and that I have **ban members** permission so I can ${config.action} for actual cases.`,
          // allowed_mentions: {},
        });
      } else if (failed && !config.experiments.includes("no-warning-msg")) {
        await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id, {
          content: `⚠️ User <@${userId}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# Please check my permissions to **ensure my role is higher** than their highest role and that I have **ban members** permission.`,
          allowed_mentions: {},
        });
        await emojiReact;
      }
    } catch (err) {
      // somewhat chance the channel is deleted or the bot lost perms to send messages there
      console.error(`Failed to send log message (MessageCreate handler): ${err}`);
    }
  } catch (err) {
    console.error(`Error with MessageCreate handler: ${err}`);
  }
};

client.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, api }) => {
  const guildId = interaction.guild_id;

  try {
    // slash command handler: show modal
    if (guildId && interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot") {
      let config = await getConfig(guildId);
      config ||= {
        guild_id: guildId,
        honeypot_channel_id: null,
        honeypot_msg_id: null,
        log_channel_id: null,
        action: 'softban',
        experiments: []
      };

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
                { label: "Softban (kick)", value: "softban", description: "Bans & unbans to delete last 1hr of messages", default: config.action === "softban" || (config.action as any) === "kick" },
                { label: "Ban", value: "ban", description: "Permanently bans the user to also delete last 1hr of messages", default: config.action === "ban" },
                { label: "Disabled", value: "disabled", description: "Don’t do anything", default: config.action === "disabled" }
              ],
              min_values: 1,
              max_values: 1,
              required: true,
            }
          },
          {
            type: ComponentType.Label,
            label: "Experiments",
            // description: "Some optional experimental features to try out",
            component: {
              type: ComponentType.StringSelect,
              custom_id: "honeypot_experiments",
              placeholder: "Select experiments to enable",
              options: [
                { label: "No Warning Msg", value: "no-warning-msg", description: "Don’t include a warning message in the #honeypot channel", default: config.experiments.includes("no-warning-msg") },
                { label: "No DM", value: "no-dm", description: "Don’t DM the user that they triggered the honeypot", default: config.experiments.includes("no-dm") },
                { label: "Channel Warmer", value: "channel-warmer", description: "Keep the honeypot channel active (every day)", default: config.experiments.includes("channel-warmer") },
                { label: "Random Channel Name", value: "random-channel-name", description: "Randomize the honeypot channel name (every day)", default: config.experiments.includes("random-channel-name") },
                { label: "Random Channel Name (Chaos)", value: "random-channel-name-chaos", description: "Randomise the honeypot channel name with random characters (every day)", default: config.experiments.includes("random-channel-name-chaos") },
              ],
              max_values: 5,
              required: false,
            }
          }
        ]
      };
      await api.interactions.createModal(interaction.id, interaction.token, modal);
      return;
    }

    // modal submit handler: update config from modal values
    else if (guildId && interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_config_modal`) {
      const newConfig: HoneypotConfig = {
        guild_id: guildId,
        honeypot_channel_id: null,
        honeypot_msg_id: null,
        log_channel_id: null,
        action: 'softban',
        experiments: []
      }

      for (const label of interaction.data.components) {
        if (label.type !== ComponentType.Label) continue;
        const c = (label).component ?? label;
        if (!c) continue;

        if (c.type === ComponentType.ChannelSelect) {
          if (c.custom_id === "honeypot_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.honeypot_channel_id = c.values[0]!;
          if (c.custom_id === "log_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.log_channel_id = c.values[0]!;
        }
        if (c.type === ComponentType.StringSelect) {
          if (c.custom_id === "honeypot_action" && Array.isArray(c.values) && c.values.length > 0) {
            if (["kick", "ban", "disabled"].includes(c.values[0]!)) newConfig.action = c.values[0] as any;
          }
          if (c.custom_id === "honeypot_experiments" && Array.isArray(c.values)) {
            for (const val of c.values) {
              if (["no-warning-msg", "no-dm", "random-channel-name", "random-channel-name-chaos", "channel-warmer"].includes(val)) {
                newConfig.experiments.push(val as any);
              }
            }
          }
        }
      }

      // shouldn’t happen, but just in case
      if (!newConfig.honeypot_channel_id) {
        await api.interactions.reply(interaction.id, interaction.token, {
          content: `Honeypot channel is required! No changes have been made.`,
          allowed_mentions: {},
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const prevConfig = await getConfig(guildId);
      const honeypotChanged = newConfig.honeypot_channel_id !== prevConfig?.honeypot_channel_id;
      const logChanged = newConfig.log_channel_id !== prevConfig?.log_channel_id;
      const actionChanged = newConfig.action !== prevConfig?.action;

      // pretty reasonable requests to ensure user can even do said actions
      {
        const resolvedChannel = interaction.data.resolved?.channels?.[newConfig.honeypot_channel_id];
        const requiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels;
        if (honeypotChanged && !hasPermission(BigInt(resolvedChannel?.permissions || "0"), requiredPerms)) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: `You don’t have enough permissions to set the honeypot channel to <#${newConfig.honeypot_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel, Manage Messages, Manage Channels.\n-# No settings have been changed.`,
            allowed_mentions: {},
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const resolvedLogChannel = newConfig.log_channel_id ? interaction.data.resolved?.channels?.[newConfig.log_channel_id] : null;
        const logRequiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel;
        if (logChanged && newConfig.log_channel_id && !hasPermission(BigInt(resolvedLogChannel?.permissions || "0"), logRequiredPerms)) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: `You don’t have enough permissions to set the log channel to <#${newConfig.log_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel.\n-# No settings have been changed.`,
            allowed_mentions: {},
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const memberPerms = interaction.member?.permissions
        const banEvents = ["ban", "softban"];
        // check ban permissions even if the action didn’t change, because any new channel moved to can suddenly ban people
        if ((actionChanged || true) && banEvents.includes(newConfig.action) && memberPerms && !hasPermission(BigInt(memberPerms), PermissionFlagsBits.BanMembers)) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: `You need the Ban Members permission to set the honeypot action to "${newConfig.action}".\n-# No settings have been changed.`,
            allowed_mentions: {},
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const usingChannelNameExperiment = (newConfig.experiments.includes("random-channel-name") || newConfig.experiments.includes("random-channel-name-chaos"));
        if (usingChannelNameExperiment && !hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.ManageChannels)) {
          await api.interactions.reply(interaction.id, interaction.token, {
            content: `I need the Manage Channels permission to enable the "Random Channel Name" experiment.\n-# No settings have been changed.`,
            allowed_mentions: {},
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        // if any other actions added in future, add their equivalent permission checks here
      }

      // if honeypot channel changed or current honeypot msg is invalid, create new honeypot message
      // otherwise try to edit it with latest data
      // but if either fail, then let user know its broken sadly
      let msgId: string | null = null;
      if (!newConfig.experiments.includes("no-warning-msg")) {
        try {
          const count = await getModeratedCount(guildId);
          const messageBody = honeypotWarningMessage(count, newConfig.action);
          if (honeypotChanged || !prevConfig?.honeypot_msg_id) {
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
      } else if (prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
        // they didn’t want honeypot msg, so delete old one if exists
        await api.channels.deleteMessage(
          prevConfig.honeypot_channel_id,
          prevConfig.honeypot_msg_id,
        ).catch(() => null);
        newConfig.honeypot_msg_id = null;
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

      await setConfig({
        ...(prevConfig || {}),
        ...newConfig,
        honeypot_msg_id: msgId || newConfig.honeypot_msg_id || prevConfig?.honeypot_msg_id || null,
      });
      await api.interactions.reply(interaction.id, interaction.token, {
        content: `Honeypot config updated!\n-# - Channel: <#${newConfig.honeypot_channel_id}>\n-# - Log Channel: ${newConfig.log_channel_id ? `<#${newConfig.log_channel_id}>` : '*(Not set)*'}\n-# - Action: **${newConfig.action}**${newConfig.experiments.length > 0 ? `\n-# - Experiments: ${newConfig.experiments.map(e => `\`${e}\``).join(", ")}` : ''}`,
        allowed_mentions: {},
      });

      if (msgId && prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
        await api.channels.deleteMessage(
          prevConfig.honeypot_channel_id,
          prevConfig.honeypot_msg_id,
          { reason: "Honeypot channel changed, so cleaning up old honeypot message" }
        ).catch(() => null);
      }

      // run any experiments that were just enabled immediately to show user it works
      if (!prevConfig?.experiments.includes("channel-warmer") && newConfig.experiments.includes("channel-warmer")) {
        await channelWarmerExperiment(guildId, newConfig.honeypot_channel_id!)
          .catch((err) => console.error(`Failed to run channel warmer experiment immediately after enabling: ${err}`));
      }
      if (
        (!prevConfig?.experiments.includes("random-channel-name") && newConfig.experiments.includes("random-channel-name"))
        || (!prevConfig?.experiments.includes("random-channel-name-chaos") && newConfig.experiments.includes("random-channel-name-chaos"))
      ) {
        await randomChannelNameExperiment(guildId, newConfig.honeypot_channel_id!, newConfig.experiments.includes("random-channel-name-chaos"))
          .catch((err) => console.error(`Failed to run random channel name experiment immediately after enabling: ${err}`))
      }
      return;
    }

    // dm command to show stats
    else if (interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "stats") {
      const { totalGuilds, totalModerated } = await getStats();
      const userId = (interaction.user || interaction.member?.user)?.id
      const userModeratedCount = userId ? await getUserModeratedCount(userId) : 0;

      await api.interactions.reply(interaction.id, interaction.token, {
        flags: MessageFlags.IsComponentsV2,
        allowed_mentions: {},
        components: [
          {
            type: ComponentType.Container,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: [
                  `## ${CUSTOM_EMOJI} Honeypot Bot Statistics ${CUSTOM_EMOJI}`,
                  "",
                  `Total servers: \`${totalGuilds.toLocaleString()}\``,
                  `Total moderations: \`${totalModerated.toLocaleString()}\``,
                  `Times you've #honeypot'd: \`${(userModeratedCount || 0).toLocaleString()}\``,
                ].join("\n"),
              },
              {
                type: ComponentType.TextDisplay,
                content: "-# Thank you for using [Honeypot Bot](https://discord.com/discovery/applications/1450060292716494940) to keep your servers safe from unwanted bots!"
              },
              {
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.Button,
                    url: `https://discord.com/oauth2/authorize?client_id=${interaction.application_id}`,
                    style: ButtonStyle.Link,
                    label: "Invite Bot",
                    emoji: { name: "honeypot", id: CUSTOM_EMOJI_ID }
                  },
                  {
                    type: ComponentType.Button,
                    url: "https://discord.gg/BanFeVWyFP",
                    style: ButtonStyle.Link,
                    label: "Support Server"
                  },
                  {
                    type: ComponentType.Button,
                    url: "https://riskymh.dev",
                    style: ButtonStyle.Link,
                    label: "riskymh.dev"
                  },
                ]
              },
            ],
          },
        ]
      });
    }

    return;
  } catch (err) {
    console.error("Error with InteractionCreate handler:", err);
  }
});

function runAtMidnightUTC(fn: () => void) {
  const now = new Date();
  const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msToMidnight = nextMidnightUTC.getTime() - now.getTime();
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000); // every 24h after first run
  }, msToMidnight);
}

async function channelWarmerExperiment(guildId: string, channelId: string) {
  const msg = await client.api.channels.createMessage(
    channelId,
    {
      content: `Keeping the honeypot channel active! ${CUSTOM_EMOJI}`,
      allowed_mentions: {},
    }
  );
  await Bun.sleep(50);
  await client.api.channels.deleteMessage(
    channelId,
    msg.id,
    { reason: "Channel warmer experiment" }
  );
}
async function randomChannelNameExperiment(guildId: string, channelId: string, isChaos = false) {
  let newName = "honeypot";
  if (isChaos) {
    const length = Math.floor(Math.random() * 20) + 7;
    newName = "";
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789-";
    for (let i = 0; i < length; i++) {
      newName += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } else {
    const randomNames = Array.isArray(randomChannelNames) ? randomChannelNames : ["honeypot"]
    newName = randomNames[Math.floor(Math.random() * randomNames.length)];
  }
  await client.api.channels.edit(
    channelId,
    { name: newName },
    { reason: "Random channel name experiment" + (isChaos ? " (chaos edition)" : "") }
  );
}

runAtMidnightUTC(async () => {
  // intentionally only run one at a time with delay to avoid rate limits (as least important feature)

  // channel warmer experiment - send a msg and instantly delete it to keep channel active
  const channelWarmer = async () => {
    const guilds = await getGuildsWithExperiment("channel-warmer");
    const configs = guilds.filter(config => !!config?.honeypot_channel_id);
    for (const config of configs) {
      try {
        await channelWarmerExperiment(config.guild_id, config.honeypot_channel_id!);
        await Bun.sleep(1_000);
      } catch (err) {
        console.error(`Channel warmer experiment execution failed for guild:`, err);
      }
    }
  };

  // random channel name experiment - change the honeypot channel name to a random name
  const randomChannelName = async () => {
    const guilds = await getGuildsWithExperiment("random-channel-name");
    const configs = guilds.filter(config => !!config?.honeypot_channel_id);
    for (const config of configs) {
      try {
        await randomChannelNameExperiment(
          config.guild_id,
          config.honeypot_channel_id!,
          config.experiments.includes("random-channel-name-chaos")
        )
        await Bun.sleep(1_000);
      } catch (err) {
        console.error(`Random channel name experiment execution failed for guild:`, err);
      }
    }
  };

  await Promise.all([
    channelWarmer(),
    randomChannelName(),
  ]);
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
      default_member_permissions:
        (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels).toString(),
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild],
    },
    {
      name: "stats",
      description: "See statistics all servers using honeypot",
      type: ApplicationCommandType.ChatInput,
      options: [],
      contexts: [InteractionContextType.BotDM],
    },
  ]);
});

gateway.connect();
