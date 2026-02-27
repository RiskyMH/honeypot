import { GatewayDispatchEvents, type APIMessage } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { getGuildInfo } from "../utils/cache";
import { CUSTOM_EMOJI_ID } from "../utils/constants";
import { getConfig, getHoneypotMessages, logModerateEvent, getModeratedCount } from "../utils/db";
import { honeypotUserDMMessage, honeypotWarningMessage, logActionMessage } from "../utils/messages";

// userIds, to prevent retrying to DM users if the API fails (ie due to DMs closed)
export const failedToDmUsers = [] as string[];

const handler: EventHandler<GatewayDispatchEvents.MessageCreate> = {
    event: GatewayDispatchEvents.MessageCreate,
    handler: async ({ data: message, api, applicationId }) => {
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
    }
};

const onMessage = async ({ userId, channelId, guildId, messageId, threadId }: { userId: string, channelId: string, guildId: string, messageId?: string, threadId?: string }, api: API | API2) => {
    try {
        const config = await getConfig(guildId);
        if (!config || !config.action) return;
        if (channelId !== config.honeypot_channel_id) return

        // just for the fun of it to acknowledge it saw the message
        let emojiReact = null as null | Promise<any>
        if (messageId) emojiReact = api.channels.addMessageReaction(
            channelId,
            messageId,
            `honeypot:${CUSTOM_EMOJI_ID}`,
            // this really doesn’t matter, so lets not have it get stuck in ratelimit queue if bot gets enough usage
            { signal: AbortSignal.timeout(1000) }
        ).catch(() => null);

        if (config.action === 'disabled') return;

        const customMessages = await getHoneypotMessages(guildId);

        // should DM user first before banning so that discord has less reason to block it
        let dmMessage: APIMessage | null = null;
        let isOwner = false;
        try {
            const timeout = AbortSignal.timeout(2500);
            let guild = await getGuildInfo(api, guildId, timeout).catch(() => null);
            isOwner = guild?.ownerId === userId;
            if (!config.experiments.includes("no-dm") || failedToDmUsers.includes(userId)) {
                const link = `https://discord.com/channels/${guildId}/${channelId}/${config.honeypot_msg_id || messageId || ""}`;
                const dmContent = honeypotUserDMMessage(
                    config.action,
                    guild?.name ?? guildId!,
                    guild?.vanityInviteCode ? `https://discord.gg/${guild.vanityInviteCode}` : undefined,
                    link,
                    isOwner,
                    customMessages?.dm_message
                );
                const { id: dmChannel } = await api.users.createDM(userId, { signal: timeout });
                dmMessage = await api.channels.createMessage(dmChannel, dmContent, { signal: timeout })
            }
        } catch (err) {
            /* Ignore DM errors (user has DMs closed, etc.) */
            console.log(`Failed to send DM to user: ${err}`)
            if (err instanceof Error && !["AbortError", "TimeoutError"].includes(err.name)) {
                failedToDmUsers.push(userId);
                if (failedToDmUsers.length > 100) {
                    failedToDmUsers.shift();
                }
            }
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
                    { reason: "Triggered honeypot -> softban (kick) 1/4" }
                );
                // maybe discord needs time to yeet their messages?
                await Bun.sleep(5_000)
                await api.guilds.unbanUser(
                    guildId,
                    userId,
                    { reason: "Triggered honeypot -> softban (kick) 2/4" }
                );

                // double unban setup? surely this gotta yeet them now??
                await Bun.sleep(500)
                await api.guilds.banUser(
                    guildId,
                    userId,
                    { delete_message_seconds: 3600 },
                    { reason: "Triggered honeypot -> softban (kick) 3/4" }
                );
                await Bun.sleep(5_000)
                await api.guilds.unbanUser(
                    guildId,
                    userId,
                    { reason: "Triggered honeypot -> softban (kick) 4/4" }
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
                honeypotWarningMessage(moderatedCount, config.action, customMessages?.warning_message)
            );
        } catch (err) { console.log(`Failed to update honeypot message: ${err}`); }

        try {
            if (config.log_channel_id && !failed && !isOwner) {
                await api.channels.createMessage(config.log_channel_id,
                    logActionMessage(userId, config.honeypot_channel_id, config.action, customMessages?.log_message)
                );
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
            console.log(`Failed to send log message (MessageCreate handler): ${err}`);
        }
    } catch (err) {
        console.error(`Error with MessageCreate handler: ${err}`);
    }
};


export default handler;
