import { GatewayDispatchEvents, type RESTAPIMessageReference, RESTJSONErrorCodes, type APIMessage, MessageReferenceType } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { getDmChannelCache, getGuildInfo, getSubscribedChannelCache, setDmChannelCache, setSubscribedChannelCache } from "../utils/cache";
import { CUSTOM_EMOJI_ID, HAS_MESSAGE_INTENT } from "../utils/constants";
import { honeypotUserDMMessage, honeypotWarningMessage, logActionMessage } from "../utils/messages";
import { DiscordAPIError } from "@discordjs/rest";
import { styleText } from "node:util";

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
                messageId: message.id
            }, api, db, redis);
        }

        // if it's a normal message, only trigger if it's not a bot (to avoid spam as we trust actual bots more)
        if (!message.author.bot) {
            return await onMessage({
                userId: message.author.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                messageId: message.id
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
    { userId, channelId, guildId, messageId, threadId }: { userId: string, channelId: string, guildId: string, messageId?: string, threadId?: string },
    api: API | API2,
    db: typeof import("../utils/db"),
    redis?: Bun.RedisClient
) => {
    try {
        if (!process.env.HAS_PROXY_WS && redis && !(await getSubscribedChannelCache(guildId, redis))?.includes(channelId)) return;

        const result = await db.getConfigWithChannels(guildId);
        if (!result) return;
        const { config, channels } = result;
        if (!config || !config.action) return;
        const matchedChannel = channels.find(c => c.channel_id === channelId);
        if (!matchedChannel) {
            if (redis) {
                const ids = channels.map(c => c.channel_id);
                setSubscribedChannelCache(guildId, ids.length > 0 ? ids : ["none"], redis);
            }
            return;
        }

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

        const preActionPromise = Bun.sleep(2000)
        const preActionAbort = AbortSignal.timeout(3500);

        let forwardPromise = null as null | Promise<any>;
        if (HAS_MESSAGE_INTENT && config.experiments.includes("forward-message") && config.log_channel_id && messageId) {
            // intentionally not awaited as in theory we can do DM and this at same time (and avoid extra wait-time)
            forwardPromise = api.channels.createMessage(config.log_channel_id, {
                message_reference: {
                    type: MessageReferenceType.Forward,
                    channel_id: channelId,
                    message_id: messageId,
                    guild_id: guildId,
                }
            }).catch(err => console.log(`Failed to forward message to log channel: ${err}`));
        }

        let timeoutPromise = null as null | Promise<any>;
        if (config.experiments.includes("timeout-first")) {
            // intentionally not awaited as in theory we can do DM and this at same time (and avoid extra wait-time)
            timeoutPromise = api.guilds.editMember(guildId, userId,
                { communication_disabled_until: new Date(Date.now() + 3_600_000).toISOString() },
                { reason: `Triggered honeypot -> timeout for 1hr before ${config.action}`, signal: preActionAbort }
            ).then(() => Bun.sleep(50))
                .catch(err => console.log(`Failed to timeout user before ${config.action}: ${err}`));
        }

        const customMessages = await db.getHoneypotMessages(guildId);

        // should DM user first before banning so that discord has less reason to block it
        let isOwner = false;
        const dmMessage: Promise<APIMessage | null> = (async () => {
            try {
                const guild = await getGuildInfo(api, guildId, preActionAbort, redis).catch(() => null);
                isOwner = guild?.ownerId === userId;
                if (!config.experiments.includes("no-dm")) {
                    let dmChannel = redis && await getDmChannelCache(userId, redis);
                    if (!dmChannel) {
                        ({ id: dmChannel } = await api.users.createDM(userId, { signal: preActionAbort }));
                        if (redis) setDmChannelCache(userId, dmChannel, redis);
                    }
                    const reinviteCode = config.experiments.includes("reinvite") && await db.getReinvite(guildId);
                    const link = `https://discord.com/channels/${guildId}/${channelId}/${matchedChannel.msg_id || messageId || ""}`;
                    const dmContent = honeypotUserDMMessage(
                        config.action,
                        guild?.name ?? guildId!,
                        guild?.isDiscoverable ? `https://discord.com/servers/${guildId}` : undefined,
                        link,
                        reinviteCode ? `https://discord.gg/${reinviteCode}` : null,
                        isOwner,
                        customMessages?.dm_message
                    );
                    return await api.channels.createMessage(dmChannel, dmContent, { signal: preActionAbort });
                }
            } catch (err) {
                /* Ignore DM errors (user has DMs closed, etc.) */
                if (`${err}` === "AbortError: The operation was aborted." || `${err}` === "Error: Request aborted manually") {
                    console.log(styleText("dim", `Failed to send DM to user: ${err}`));
                } else if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser || err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds)) {
                    console.log(styleText("dim", `Failed to send DM to user: ${err}`));
                } else {
                    console.log(`Failed to send DM to user: ${err}`)
                }
            }
            return null;
        })();

        // we prob will win forwarding before the ban's delete comes into action, so no point delaying the ban to wait for msg to create (and not the biggest deal if it fails)
        // also if timeout fails, we don't want to wait too long before banning
        await Promise.race([preActionPromise, dmMessage, timeoutPromise, forwardPromise].filter(p => !!p));

        let failed: boolean | "permissions" | "owner" | "unban" = false;
        if (!isOwner) try {
            // normally 1hr, but with the option only do last 15min
            const deleteMessageSeconds = config.experiments.includes("only-recent-delete")
                ? 900 // 15min
                : 3600; // 1hr

            if (config.action === 'ban') {
                // Ban: permanent ban, delete last 1 hour of messages
                await api.guilds.banUser(
                    guildId,
                    userId,
                    { delete_message_seconds: deleteMessageSeconds },
                    { reason: "Triggered honeypot -> ban" }
                );
            } else if (config.action === 'softban' || config.action === 'kick') {
                // Kick: kick but via ban/unban, delete last 1 hour of messages
                await api.guilds.banUser(
                    guildId,
                    userId,
                    { delete_message_seconds: deleteMessageSeconds },
                    { reason: "Triggered honeypot -> softban (kick) 1/2" }
                );
                try {
                    await Bun.sleep(250);
                    await api.guilds.unbanUser(
                        guildId,
                        userId,
                        { reason: "Triggered honeypot -> softban (kick) 2/2" }
                    );
                } catch (err) {
                    console.log(`Failed to unban user after ban: ${err}`);
                    // maybe discord hasn't banned yet and is throwing unknown ban, so try again after a short wait
                    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownBan) {
                        // If its still throwing unknown ban, then the user is likely already unbanned by some external force
                    } else {
                        failed = "unban";
                    }
                }

                // https://github.com/discord/discord-api-docs/issues/8360
                // sometimes banning doesn't actually remove messages - maybe doing it again later helps
                // (async () => {
                //     await Bun.sleep(10_000)
                //     // put it here instead of above because they may join back too early and get kicked again which isn't any good
                //     await api.guilds.unbanUser(
                //         guildId,
                //         userId,
                //         { reason: "Triggered honeypot -> softban (kick) 2/4" }
                //     );

                //     await api.guilds.banUser(
                //         guildId,
                //         userId,
                //         { delete_message_seconds: deleteMessageSeconds },
                //         { reason: "Triggered honeypot -> softban (kick) 3/4", signal: AbortSignal.timeout(25_000) }
                //     );
                //     await api.guilds.unbanUser(
                //         guildId,
                //         userId,
                //         { reason: "Triggered honeypot -> softban (kick) 4/4", signal: AbortSignal.timeout(25_000) }
                //     );
                // })().catch(err =>
                //     console.log(`Failed to double softban user (probably not an issue): ${err}`)
                // );
            } else {
                console.error("Unknown action in honeypot config:", config.action);
                failed = true;
            }
        } catch (err) {
            if (err instanceof DiscordAPIError && (err.code == RESTJSONErrorCodes.MissingPermissions)) {
                console.log(styleText("dim", `Failed to ${config.action} user: ${err}`));
                failed = "permissions";
            } else {
                console.log(`Failed to ${config.action} user: ${err}`);
                failed = true;
            }
        } else {
            // server owner cannot be banned/kicked by anyone
            failed = "owner";
        };
        if (!failed && !isOwner) {
            await db.logModerateEvent(guildId, userId, matchedChannel.channel_id);
            redis?.publish("moderate_event", "+1");
        }

        const moderatedCount = await db.getModeratedCount(guildId, channels.length > 1 ? matchedChannel.channel_id : null);

        try {
            // const reply = (messageId && channelId === matchedChannel.channel_id) ? {
            //     message_id: messageId,
            //     fail_if_not_exists: false,
            // } satisfies RESTAPIMessageReference : undefined;
            const reply = undefined as RESTAPIMessageReference | undefined;

            if (config.log_channel_id && !failed && !isOwner) {
                await api.channels.createMessage(config.log_channel_id, {
                    ...logActionMessage(userId, matchedChannel.channel_id, config.action, customMessages?.log_message, moderatedCount),
                    allowed_mentions: { users: [userId] },
                });
            } else if (isOwner) {
                await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                    content: `⚠️ User <@${userId}> triggered the honeypot, but they are the **server owner** so I cannot ${config.action} them.\n-# In anycase **ensure my role is higher** than people’s highest role and that I have **ban members** permission so I can ${config.action} for actual cases.`,
                    allowed_mentions: { users: [userId] },
                    message_reference: reply
                });
            } else if (failed === "unban" && config.action === "softban") {
                await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                    content: `⚠️ User <@${userId}> triggered the honeypot, but I failed to **fully** softban them.\n-# They may still be banned but you can manually unban them in server settings.`,
                    allowed_mentions: { users: [userId] },
                    message_reference: reply
                });
                await emojiReact;
            } else if (failed) {
                await api.channels.createMessage(config.log_channel_id || matchedChannel.channel_id, {
                    content: `⚠️ User <@${userId}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# Please check my permissions to **ensure my role is higher** than their highest role and that I have **ban members** permission.`,
                    allowed_mentions: { users: [userId] },
                    message_reference: reply
                });
                await emojiReact;
            }
        } catch (err) {
            // somewhat chance the channel is deleted or the bot lost perms to send messages there
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

        if (matchedChannel.msg_id && !config.experiments.includes("no-warning-msg")) try {
            await api.channels.editMessage(
                matchedChannel.channel_id,
                matchedChannel.msg_id,
                honeypotWarningMessage(moderatedCount, config.action, customMessages?.warning_message)
            );
        } catch (err) {
            if (err instanceof DiscordAPIError && err.code == RESTJSONErrorCodes.UnknownMessage) {
                console.log(styleText("dim", `Failed to update honeypot message: ${err}`));
                await db.unsetHoneypotMsg(guildId, matchedChannel.msg_id!);
            } else console.log(`Failed to update honeypot message: ${err}`);
        }

    } catch (err) {
        console.error(`Error with MessageCreate handler: ${err}`);
    }
};


export default handler;
