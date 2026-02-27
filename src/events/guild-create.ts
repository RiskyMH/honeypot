import { ChannelType, GatewayDispatchEvents, type GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { guildCache } from "../utils/cache";
import { getConfig, getModeratedCount, setConfig } from "../utils/db";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { honeypotWarningMessage } from "../utils/messages";

const handler: EventHandler<GatewayDispatchEvents.GuildCreate> = {
    event: GatewayDispatchEvents.GuildCreate,
    handler: async ({ data: guild, api, applicationId }) => {
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
                console.log(`Failed to create/send honeypot message: ${err}`);
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
                    console.log(`Failed to send welcome/setup message: ${err}`);
                }
            }
        } catch (err) {
            console.log(`Error with GuildCreate handler: ${err}`);
        }
    }
};

async function findOrCreateHoneypotChannel(api: API | API2, guild: GatewayGuildCreateDispatchData): Promise<string> {
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


async function postWarning(api: API | API2, channelId: string, applicationId: string, moderatedCount = 0) {
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

export default handler;