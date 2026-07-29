import { GatewayDispatchEvents, RESTJSONErrorCodes, MessageReferenceType, MessageType, ComponentType, MessageFlags, ButtonStyle, type APIUser, type PartialAPIMessageInteractionGuildMember } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { addToEnsureMsgDeleteQueue, getDmChannelCache, getGuildInfo, getIsAlreadyModerating, getSubscribedChannelCache, setDmChannelCache, setIsAlreadyModerating, setSubscribedChannelCache, unsetIsAlreadyModerating } from "../utils/cache";
import { CUSTOM_EMOJI_ID, HAS_MESSAGE_INTENT } from "../utils/constants";
import { honeypotUserDMMessage, honeypotWarningMessage, logActionMessage } from "../utils/messages";
import { DiscordAPIError } from "@discordjs/rest";
import { styleText } from "node:util";
import { getDiscordDate } from "../utils/tools";
import type { HoneypotConfig, HoneypotChannel } from "../utils/db";


const handler: EventHandler<GatewayDispatchEvents.MessageCreate> = {
    event: GatewayDispatchEvents.MessageCreate,
    handler: async ({ data: message, api, applicationId, redis, db }) => {
        if (!message.guild_id) return;

        // if a user used a slash command, attribute it to the user instead of ignoring as its a bot msg
        if (message.interaction_metadata && message.author.id !== applicationId) {
            return await onMessage({
                userId: message.interaction_metadata.user.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                messageId: message.id,
                msgType: message.type,
                fullMember: message.interaction?.member,
                fullUser: message.interaction_metadata.user,
            }, api, db, redis);
        }

        // if it's a normal message, only trigger if it's not a bot (to avoid spam as we trust actual bots more)
        if (!message.author.bot && !message.author.system) {
            if (ignoredMessageTypes.has(message.type)) return;
            return await onMessage({
                userId: message.author.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                messageId: message.id,
                msgType: message.type,
                fullMember: message.member,
                fullUser: message.author,
            }, api, db, redis);
        }

        // if it's a bot message, still get the proxy to properly subscribe and avoid seeing the spam
        if (process.env.HAS_PROXY_WS && redis && message.guild_id) {
            const result = await db.getConfigWithChannels(message.guild_id);
            if (!result) return;
            const { config, channels } = result;
            if (!config || !config.action) return;
            if (channels.some(c => c.channel_id === message.channel_id)) return;
            const ids = channels.map(c => c.channel_id);
            setSubscribedChannelCache(message.guild_id, ids.length > 0 ? ids : ["none"], redis);
        }
    }
};

const onMessage = async (
    { userId, channelId, guildId, messageId, threadId, msgType, fullUser, fullMember }
        : { userId: string, channelId: string, guildId: string, messageId?: string, threadId?: string, msgType?: MessageType, fullUser?: APIUser, fullMember?: PartialAPIMessageInteractionGuildMember },
    api: API | API2,
    db: typeof import("../utils/db"),
    redis?: Bun.RedisClient
) => {
    try {
        if (!process.env.HAS_PROXY_WS && redis) {
            const channels = await getSubscribedChannelCache(guildId, redis)
            if (channels && !channels.includes(channelId)) return;
        }

        const result = await db.getConfigWithChannels(guildId);
        if (!result) return;

        const { config, channels } = result;
        if (!config) return;

        // THE IMPORTANT CHECK
        const matchedChannel = channels.find(c => c.channel_id === channelId);
        if (!matchedChannel) {
            if (redis) {
                const ids = channels.map(c => c.channel_id);
                setSubscribedChannelCache(guildId, ids.length > 0 ? ids : ["none"], redis);
            }
            // the last return statement before banning said person
            return;
        }

        if (messageId && HAS_MESSAGE_INTENT && config.experiments.includes("ensure-msg-delete") && config.action !== 'disabled') {
            deleteTriggeringMessage(api, channelId, messageId);
        } else if (messageId) {
            emojiReactAcknowledgement(api, channelId, messageId);
        }

        if (config.action === 'disabled') return;

        if (redis) {
            if (await getIsAlreadyModerating(guildId, userId, redis))
                return console.log(styleText("dim", "Already moderating user, skipping..."));
            setIsAlreadyModerating(guildId, userId, redis);
        }

        const preActionPromise = Bun.sleep(2000)
        const preActionAbort = new AbortController();

        const forwardPromise = maybeForwardMessage(api, guildId, channelId, messageId, msgType, config, preActionAbort.signal);
        const timeoutPromise = maybeTimeoutMember(api, guildId, userId, config, preActionAbort.signal)

        const guildInfo = await getGuildInfo(api, guildId, AbortSignal.timeout(500), redis).catch(() => null);
        const permissionSkip = getPermissionSkip(guildInfo, userId, fullMember?.roles || []);

        const customMessages = await db.getHoneypotMessages(guildId);
        const dmMessage = maybeDmMember(api, db, guildId, channelId, userId, messageId, config, guildInfo, permissionSkip, customMessages?.dm_message, preActionAbort.signal, redis)

        await Promise.race([preActionPromise, Promise.all([dmMessage, timeoutPromise, forwardPromise].filter(p => !!p))]);

        let failed: false | "permissions" | "admin" | "unban" | true = false;
        if (!permissionSkip) {
            failed = await executeAction(api, guildId, userId, config, preActionAbort);
        } else {
            failed = "admin";
        }

        if (!failed && !permissionSkip) {
            await db.logModerateEvent(guildId, userId, matchedChannel.channel_id);
            redis?.publish("moderate_event", "+1");

            const id = messageId || threadId || null;
            if (id) {
                const diffSeconds = Math.floor((Date.now() - getDiscordDate(id)) / 1000);
                if (diffSeconds > 20) {
                    console.log(styleText("reset", `Moderated user in ${diffSeconds}s from ${messageId ? "message" : "thread"} creation`));
                }
            }
            if (!preActionAbort.signal.aborted) preActionAbort.abort();
        }

        if (redis) unsetIsAlreadyModerating(guildId, userId, redis);

        const moderatedCount = await db.getModeratedCount(guildId, channels.length > 1 ? matchedChannel.channel_id : null);
        await Promise.all([
            logMessage(api, db, config, userId, guildId, matchedChannel, customMessages.log_message, moderatedCount, failed, permissionSkip, fullUser, fullMember),
            updateWarning(api, db, config, matchedChannel, moderatedCount, customMessages.warning_message, guildId),
            HAS_MESSAGE_INTENT && config.experiments.includes("ensure-msg-delete") && failed === false
                ? addToEnsureMsgDeleteQueue(userId, guildId, redis) : null,
        ]);
    } catch (err) {
        console.error(`Error with MessageCreate handler: ${err}`);
    }
};


async function executeAction(
    api: API | API2,
    guildId: string,
    userId: string,
    config: HoneypotConfig,
    preActionAbort: AbortController
): Promise<false | "permissions" | "unban" | true> {
    const deleteMessageSeconds = config.experiments.includes("only-recent-delete") ? 900 : 3600;

    try {
        if (config.action === 'ban') {
            await api.guilds.banUser(
                guildId,
                userId,
                { delete_message_seconds: deleteMessageSeconds },
                { reason: "Triggered honeypot -> ban" }
            );
            Bun.sleep(150).then(() => preActionAbort.abort());
        } else if (config.action === 'softban' || (config.action as string) === 'kick') {
            await api.guilds.banUser(
                guildId,
                userId,
                { delete_message_seconds: deleteMessageSeconds },
                { reason: "Triggered honeypot -> softban (kick) 1/2" }
            );
            Bun.sleep(150).then(() => preActionAbort.abort());
            try {
                await Bun.sleep(250);
                await api.guilds.unbanUser(
                    guildId,
                    userId,
                    { reason: "Triggered honeypot -> softban (kick) 2/2" }
                );
            } catch (err) {
                if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownBan) {
                    console.log(styleText("dim", `Failed to unban user after ban: ${err}`));
                } else {
                    console.log(`Failed to unban user after ban: ${err}`);
                    return "unban";
                }
            }
        } else if (config.action === 'disabled') {
            return false;
        } else {
            console.error("Unknown action in honeypot config:", config.action);
            (config.action satisfies never);
            return true;
        }
        return false;
    } catch (err) {
        if (err instanceof DiscordAPIError && (err.code == RESTJSONErrorCodes.MissingPermissions)) {
            console.log(styleText("dim", `Failed to ${config.action} user: ${err}`));
            return "permissions";
        } else {
            console.log(`Failed to ${config.action} user: ${err}`);
            return true;
        }
    }
}


function getPermissionSkip(
    guildInfo: { ownerId: string; adminRoles?: string[] } | null,
    userId: string,
    userRoles: string[]
): "owner" | "admin" | false {
    if (guildInfo?.ownerId === userId) return "owner";
    if (guildInfo?.adminRoles?.some(role => userRoles.includes(role))) return "admin";
    return false;
}


const ignoredMessageTypes = new Set([
    MessageType.UserJoin,
    MessageType.ChannelPinnedMessage,
    MessageType.GuildBoost,
    MessageType.GuildBoostTier1,
    MessageType.GuildBoostTier2,
    MessageType.GuildBoostTier3,
    MessageType.ChannelFollowAdd,
    MessageType.PollResult,
    MessageType.PurchaseNotification,
    MessageType.AutoModerationAction,
]);


export default handler;


class SelfImposedRateLimiter {
    private tiers: { max: number; interval: number; count: number; resetAt: number }[];

    constructor(tiers: { max: number; interval: number }[]) {
        const now = Date.now();
        this.tiers = tiers.map(t => ({ max: t.max, interval: t.interval, count: 0, resetAt: now + t.interval }));
    }

    tryAcquire(): boolean {
        const now = Date.now();
        let allowed = true;
        for (const tier of this.tiers) {
            if (now > tier.resetAt) {
                tier.count = 0;
                tier.resetAt = now + tier.interval;
            }
            if (tier.count >= tier.max) allowed = false;
        }
        if (!allowed) return false;
        for (const tier of this.tiers) tier.count++;
        return true;
    }
}

const reactionRateLimiter = new SelfImposedRateLimiter([
    { max: 50, interval: 5_000 }, // 50 reactions per 5 seconds (10 per second)
    { max: 500, interval: 25_000 }, // 500 reactions per 25 seconds (20 per second)
]);

function emojiReactAcknowledgement(api: API | API2, channelId: string, messageId: string) {
    if (!reactionRateLimiter.tryAcquire()) {
        console.log(styleText("dim", "Self imposed reaction ratelimit reached, skipping reaction"));
        return null;
    };

    return api.channels.addMessageReaction(
        channelId,
        messageId,
        `honeypot:${CUSTOM_EMOJI_ID}`,
        { signal: AbortSignal.timeout(1000) }
    ).catch(() => null);
}

function deleteTriggeringMessage(api: API | API2, channelId: string, messageId: string) {
    return api.channels.deleteMessage(
        channelId,
        messageId,
        { reason: "Triggered honeypot" }
    ).catch((err) => {
        if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.UnknownMessage)) {
            console.log(styleText("dim", `Triggering message already deleted: ${err}`));
        } else if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.MissingAccess || err.code === RESTJSONErrorCodes.MissingPermissions)) {
            console.log(styleText("dim", `Failed to delete triggering message, likely due to missing permissions: ${err}`));
        } else {
            console.log(`Failed to delete triggering message: ${err}`);
        }
    });
}

const forwardableMsgTypes = new Set([MessageType.Default, MessageType.Reply, MessageType.ChatInputCommand, MessageType.ContextMenuCommand]);
async function maybeForwardMessage(api: API | API2, guildId: string, channelId: string, messageId: string | undefined, msgType: MessageType | undefined, config: HoneypotConfig, preActionAbort: AbortSignal) {
    if (!HAS_MESSAGE_INTENT || !config.experiments.includes("forward-message") || !config.log_channel_id || !messageId || msgType === undefined) return null;
    if (!forwardableMsgTypes.has(msgType)) return null;
    return api.channels.createMessage(config.log_channel_id, {
        message_reference: {
            type: MessageReferenceType.Forward,
            channel_id: channelId,
            message_id: messageId,
            guild_id: guildId,
        }
    }, { signal: preActionAbort }).catch(err => {
        const discordApiError = err instanceof DiscordAPIError ? err : null;
        if (discordApiError && discordApiError.code === 160009) {
            api.channels.createMessage(config.log_channel_id!, {
                content: `Would forward https://discord.com/channels/${guildId}/${channelId}/${messageId}, but the bot doesn't have permission to Read Message History in that channel.`,
                allowed_mentions: {},
            }).catch(err => console.log(styleText("dim", `Failed to send message about missing permissions to forward to log channel: ${err}`)));
            console.log(styleText("dim", `Failed to forward message to log channel: ${err}`));
        } else if (discordApiError && discordApiError.message.includes("MESSAGE_REFERENCE_UNKNOWN_MESSAGE")) {
            console.log(styleText("dim", `Failed to forward message to log channel: ${err.toString().replace("\n", "; ")}`));
        } else if (`${err}` === "AbortError: The operation was aborted." || `${err}` === "Error: Request aborted manually") {
            console.log(styleText("dim", `Failed to forward message to log channel: ${err}`));
        } else if (discordApiError && (discordApiError.code === RESTJSONErrorCodes.MissingAccess || discordApiError.code === RESTJSONErrorCodes.MissingPermissions)) {
            console.log(styleText("dim", `Failed to forward message to log channel: ${err}`));
        } else {
            console.log(`Failed to forward message to log channel: ${err}`);
        }
    });
}

function maybeTimeoutMember(api: API | API2, guildId: string, userId: string, config: HoneypotConfig, preActionAbort: AbortSignal) {
    if (!config.experiments.includes("timeout-first")) return;
    return api.guilds.editMember(guildId, userId,
        { communication_disabled_until: new Date(Date.now() + 3_600_000).toISOString() },
        { reason: `Triggered honeypot -> timeout for 1hr before ${config.action}`, signal: preActionAbort }
    ).then(() => Bun.sleep(50))
        .catch(err => {
            if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.MissingPermissions)) {
                console.log(styleText("dim", `Failed to timeout user before ${config.action}: ${err}`));
            } else {
                console.log(`Failed to timeout user before ${config.action}: ${err}`);
            }
        });
}

const dmRateLimiter = new SelfImposedRateLimiter([
    { max: 25, interval: 5_000 }, // 25 DMs per 5 seconds (5 per second)
    { max: 60, interval: 60_000 }, // 60 DMs per 60 seconds (1 per second)
]);

async function maybeDmMember(
    api: API | API2,
    db: typeof import("../utils/db"),
    guildId: string,
    channelId: string,
    userId: string,
    messageId: string | undefined,
    config: HoneypotConfig,
    guild: Awaited<ReturnType<typeof getGuildInfo>> | null,
    permissionSkip: "owner" | "admin" | false,
    customMessage?: string | null,
    preActionAbort?: AbortSignal,
    redis?: Bun.RedisClient
) {
    try {
        if (config.experiments.includes("no-dm")) return null;

        if (!dmRateLimiter.tryAcquire()) {
            console.log(styleText("dim", "Self imposed DM ratelimit reached, skipping DM to user"));
            return null;
        }

        let dmChannel = redis && await getDmChannelCache(userId, redis);
        if (!dmChannel) {
            ({ id: dmChannel } = await api.users.createDM(userId, { signal: preActionAbort }));
            if (redis) setDmChannelCache(userId, dmChannel, redis);
        }
        const reinviteCode = config.experiments.includes("reinvite") && await db.getReinvite(guildId);
        const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId || ""}`;
        const dmContent = honeypotUserDMMessage(
            userId,
            config.action,
            guild?.name ?? guildId!,
            guild?.isDiscoverable ? `https://discord.com/servers/${guildId}` : undefined,
            link,
            reinviteCode ? `https://discord.gg/${reinviteCode}` : null,
            permissionSkip !== false,
            customMessage
        );
        return await api.channels.createMessage(dmChannel, dmContent, { signal: preActionAbort });
    } catch (err) {
        if (`${err}` === "AbortError: The operation was aborted." || `${err}` === "Error: Request aborted manually") {
            console.log(styleText("dim", `Failed to send DM to user: ${err}`));
        } else if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser || err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds)) {
            console.log(styleText("dim", `Failed to send DM to user: ${err}`));
        } else {
            console.log(`Failed to send DM to user: ${err}`)
        }
    }
    return null;
}


async function logMessage(
    api: API | API2,
    db: typeof import("../utils/db"),
    config: HoneypotConfig,
    userId: string,
    guildId: string,
    matchedChannel: HoneypotChannel,
    customMessage: string | null,
    moderatedCount: number,
    failed: false | "permissions" | "admin" | "unban" | true,
    permissionSkip: "owner" | "admin" | false,
    fullUser?: APIUser,
    fullMember?: PartialAPIMessageInteractionGuildMember
) {
    if (!config.log_channel_id && !permissionSkip && !failed) return;

    try {
        if (config.log_channel_id && !failed && !permissionSkip) {
            await api.channels.createMessage(config.log_channel_id, {
                ...logActionMessage(fullUser || { id: userId }, fullMember || null, matchedChannel.channel_id, config.action, customMessage, moderatedCount),
                allowed_mentions: { users: [userId] },
            });
        } else if (permissionSkip) {
            await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                content: `⚠️ User <@${userId}> triggered the honeypot, but they are ${permissionSkip === "owner" ? "the **server owner** so I cannot" : "a **server admin** so I won't"} ${config.action} them.\n-# In anycase **ensure my role is higher** than people's highest role and that I have **ban members** permission so I can ${config.action} for actual cases.`,
                allowed_mentions: { users: [userId] },
            });
        } else if (failed === "unban" && config.action === "softban") {
            await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                content: `⚠️ User <@${userId}> triggered the honeypot, but I failed to **fully** softban them.\n-# They may still be banned but you can manually unban them in server settings.`,
                allowed_mentions: { users: [userId] },
            });
        } else if (failed === "permissions") {
            await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: `⚠️ User <@${userId}> triggered the honeypot, but I **failed** to ${config.action} them.`,
                    },
                    {
                        type: ComponentType.Section,
                        components: [{
                            type: ComponentType.TextDisplay,
                            content: `-# Please check my permissions to **ensure my role is higher** than their highest role and that I have **ban members** permission.`,
                        }],
                        accessory: {
                            type: ComponentType.Button,
                            style: ButtonStyle.Secondary,
                            label: "Troubleshoot",
                            custom_id: `troubleshoot_ban:${userId}`,
                        }
                    }],
                allowed_mentions: { users: [userId] },
            });
        } else if (failed) {
            await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                content: `⚠️ User <@${userId}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# This could be due to a transient Discord issue, or something unexpected. Please check my permissions in any case.`,
                allowed_mentions: { users: [userId] },
            });
        }
    } catch (err) {
        if (err instanceof DiscordAPIError) {
            if (err.code == RESTJSONErrorCodes.UnknownChannel && config.log_channel_id) {
                await db.unsetLogChannel(guildId, config.log_channel_id);
            } else if (err.code == RESTJSONErrorCodes.MissingAccess || err.code == RESTJSONErrorCodes.MissingPermissions) {
                console.log(styleText("dim", `Failed to send log message (MessageCreate handler): ${err}`));
            } else {
                console.log(`Failed to send log message (MessageCreate handler): ${err}`);
            }
        } else console.log(`Failed to send log message (MessageCreate handler): ${err}`);
    }
}

async function updateWarning(
    api: API | API2,
    db: typeof import("../utils/db"),
    config: HoneypotConfig,
    matchedChannel: HoneypotChannel,
    moderatedCount: number,
    customMessage: string | null,
    guildId: string,
) {
    if (!matchedChannel.msg_id || config.experiments.includes("no-warning-msg")) return;
    try {
        await api.channels.editMessage(
            matchedChannel.channel_id,
            matchedChannel.msg_id,
            honeypotWarningMessage(moderatedCount, config.action, customMessage)
        );
    } catch (err) {
        const discordError = err instanceof DiscordAPIError ? err : null;
        if (discordError && discordError.code == RESTJSONErrorCodes.UnknownMessage) {
            console.log(styleText("dim", `Failed to update honeypot message (after banning): ${err}`));
            await db.unsetHoneypotMsg(guildId, matchedChannel.msg_id!);
        } else if (discordError && (discordError.code == RESTJSONErrorCodes.MissingPermissions || discordError.code == RESTJSONErrorCodes.MissingAccess)) {
            console.log(styleText("dim", `Failed to update honeypot message (after banning): ${err}`));
            await db.unsetHoneypotMsg(guildId, matchedChannel.msg_id!);
        } else console.log(`Failed to update honeypot message (after banning): ${err}`);
    }
}

