import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { MessageFlags, RESTJSONErrorCodes } from "discord-api-types/v10";
import randomChannelNames from "../utils/random-channel-names.yaml";
import { CUSTOM_EMOJI } from "../utils/constants";
import type { Cron } from "./crons";
import { DiscordAPIError } from "@discordjs/rest";
import { styleText } from "node:util";
import type { HoneypotConfig } from "../utils/db";
import { honeypotWarningMessage } from "../utils/messages";
import { removeGuildSubscribedChannelCache, setSubscribedChannelCache } from "../utils/cache";

function shardId(id: string, total: number): number {
    let hash = 5381;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) % total;
}

export async function channelWarmerExperiment(api: API | API2, guildId: string, channelId: string) {
    const msg = await api.channels.createMessage(
        channelId,
        {
            content: `Keeping the honeypot channel active! ${CUSTOM_EMOJI}`,
            allowed_mentions: {},
            flags: MessageFlags.SuppressNotifications,
        }
    );
    await api.channels.deleteMessage(
        channelId,
        msg.id,
        { reason: "Channel warmer experiment" }
    );
}

export async function randomChannelNameExperiment(api: API | API2, guildId: string, channelId: string, isChaos = false) {
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
    await api.channels.edit(
        channelId,
        { name: newName },
        { reason: "Random channel name experiment" + (isChaos ? " (chaos edition)" : "") }
    );
}

async function channelRecreateExperiment(api: API | API2, guildId: string, channelId: string, channelModerated: number, warningMessage: string | undefined, config: HoneypotConfig) {
    const channelInfo = await api.channels.get(channelId);
    if (!('guild_id' in channelInfo)) throw new Error("Invalid channel info");

    let newName = channelInfo.name || "honeypot";
    if (config.experiments.includes("random-channel-name-chaos")) {
        const length = Math.floor(Math.random() * 20) + 7;
        newName = "";
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789-";
        for (let i = 0; i < length; i++) {
            newName += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } else if (config.experiments.includes("random-channel-name")) {
        const randomNames = Array.isArray(randomChannelNames) ? randomChannelNames : ["honeypot"]
        newName = randomNames[Math.floor(Math.random() * randomNames.length)];
    }

    const newChannel = await api.guilds.createChannel(guildId, newName ? { ...channelInfo, name: newName } : channelInfo, { reason: "Channel recreate experiment" });
    let msgId = null as string | null;
    try {
        if (!config.experiments.includes("no-warning-msg")) {
            const messageBody = honeypotWarningMessage(channelModerated, config?.action || 'softban', warningMessage);
            const msg = await api.channels.createMessage(newChannel.id, messageBody);
            msgId = msg.id;
        } else {
            // just so it has has actually had a message there
            const msg = await api.channels.createMessage(newChannel.id, {
                content: `New honeypot channel! ${CUSTOM_EMOJI}`,
                allowed_mentions: {},
                flags: MessageFlags.SuppressNotifications,
            });
            await api.channels.deleteMessage(channelId, msg.id).catch(() => { });
        }
    } catch (err) {
        console.log(`Error occurred while sending warning message in recreated channel: ${err}`);
        // its not the end of the day if we can't resend
    }
    try {
        await api.channels.delete(channelId, { reason: "Channel recreate experiment (replaced with new channel)" });
    } catch (err) {
        console.log(`Error occurred while deleting channel (recreate experiment): ${err}`);
        api.channels.createMessage(channelId, {
            content: `⚠️ This channel was supposed to be deleted and replaced with <#${newChannel.id}> for the "Channel Recreate" experiment, but I was unable to delete it. This is no longer a watched honeypot channel.`,
            allowed_mentions: {},
            flags: MessageFlags.SuppressNotifications,
        }).catch(() => { });
    }
    return { channel: newChannel.id, message: msgId };
}


const TOTAL_SHARDS = 24;

const cron: Cron = {
    name: "Experiment Runner",
    frequency: "@hourly",
    run: async (api, db, redis) => {
        // intentionally only run one at a time with delay to avoid rate limits (as least important feature)
        const currentShard = new Date().getHours();

        // channel warmer experiment - send a msg and instantly delete it to keep channel active
        const channelWarmer = async () => {
            const guilds = await db.getGuildsWithExperiment("channel-warmer");
            for (const config of guilds) {
                if (shardId(config.guild_id, TOTAL_SHARDS) !== currentShard) continue;
                if (config.experiments.includes("recreate-channel")) continue; // we are making it again so no need to change anything here
                const channels = await db.getChannels(config.guild_id);
                for (const channel of channels) {
                    try {
                        await Bun.sleep(1_000);
                        await channelWarmerExperiment(api, config.guild_id, channel.channel_id);
                    } catch (err) {
                        const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                        if (discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                            db.unsetHoneypotChannel(config.guild_id, channel.channel_id);
                        } else if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                            console.log(styleText("dim", `Channel warmer experiment execution failed: ${err}`));
                            // todo count these and if like 10 in 10 days (due to using expire on hincr in redis), then just remove the experiment from guild)
                        } else {
                            console.log(`Channel warmer experiment execution failed: ${err}`);
                        }

                        // there is no way that we can send msg in honeypot channel (as discovered above)
                        if (config.log_channel_id) {
                            await api.channels.createMessage(config.log_channel_id, {
                                content: `⚠️ There was a problem sending a message to the <#${channel.channel_id}> channel for the "Channel Warmer" experiment. Please check my permissions.`,
                                allowed_mentions: {},
                            }).catch(err => {
                                const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                                if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                                    console.log(styleText("dim", `Failed to send failed message for channel warmer experiment: ${err}`));
                                    // todo: if this happens enough times then remove the log channel from the config or something
                                } else if (config.log_channel_id && discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                                    db.unsetLogChannel(config.guild_id, config.log_channel_id);
                                    console.log(styleText("dim", `Failed to send failed message for channel warmer experiment: ${err}`));
                                } else {
                                    console.log(`Failed to send failed message for channel warmer experiment: ${err}`);
                                }
                            });
                        }
                    }
                }
            }
        };

        // random channel name experiment - change the honeypot channel name to a random name
        const randomChannelName = async () => {
            const guilds = await db.getGuildsWithExperiment("random-channel-name");
            for (const config of guilds) {
                if (shardId(config.guild_id, TOTAL_SHARDS) !== currentShard) continue;
                if (config.experiments.includes("recreate-channel")) continue; // we are making it again so no need to change anything here
                const channels = await db.getChannels(config.guild_id);
                for (const channel of channels) {
                    try {
                        await Bun.sleep(1_000);
                        await randomChannelNameExperiment(
                            api,
                            config.guild_id,
                            channel.channel_id,
                            config.experiments.includes("random-channel-name-chaos")
                        )
                    } catch (err) {
                        const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                        if (discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                            db.unsetHoneypotChannel(config.guild_id, channel.channel_id);
                        } else if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                            console.log(styleText("dim", `Random channel name experiment execution failed: ${err}`));
                            // todo count these and if like 10 in 10 days (due to using expire on hincr in redis), then just remove the experiment from guild)
                        } else {
                            console.log(`Random channel name experiment execution failed: ${err}`);
                        }

                        // missing access means there is no way we can access that channel
                        // so if there isnt a seperate log channel, no point sending a message that will always fail
                        if ((discordErrorCode !== RESTJSONErrorCodes.MissingAccess && discordErrorCode !== RESTJSONErrorCodes.UnknownChannel) || config.log_channel_id) {
                            await api.channels.createMessage(config.log_channel_id || channel.channel_id, {
                                content: `⚠️ There was a problem updating the <#${channel.channel_id}> channel for the "Random Channel Name" experiment. Please check my permissions.`,
                                allowed_mentions: {},
                            }).catch(err => {
                                const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                                if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                                    console.log(styleText("dim", `Failed to send failed message for random channel name experiment: ${err}`));
                                    // todo: if this happens enough times then remove the log channel from the config or something
                                } else if (config.log_channel_id && discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                                    db.unsetLogChannel(config.guild_id, config.log_channel_id);
                                    console.log(styleText("dim", `Failed to send failed message for random channel name experiment: ${err}`));
                                } else {
                                    console.log(`Failed to send failed message for random channel name experiment: ${err}`);
                                }
                            });
                        }
                    }
                }
            }
        };

        // channel recreate experiment - get current config (name, description, overides, etc) and make a new channel the same and then delete old (also move the events with that channel over to the new ID)
        const channelRecreate = async () => {
            const guilds = await db.getGuildsWithExperiment("recreate-channel");
            for (const config of guilds) {
                if (shardId(config.guild_id, TOTAL_SHARDS) !== currentShard) continue;
                const channels = await db.getChannels(config.guild_id);
                const existingMessages = await db.getHoneypotMessages(config.guild_id);
                for (const channel of channels) {
                    try {
                        await Bun.sleep(1_000);
                        const guildModeratedCount = await db.getModeratedCount(config.guild_id, channels.length > 1 ? channel.channel_id : null);
                        const newChannel = await channelRecreateExperiment(api, config.guild_id, channel.channel_id, guildModeratedCount, existingMessages.warning_message || undefined, config);
                        await db.replaceHoneypotChannel(config.guild_id, channel.channel_id, newChannel.channel, newChannel.message);
                        if (redis) removeGuildSubscribedChannelCache(config.guild_id, redis);
                    } catch (err) {
                        const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                        if (discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                            db.unsetHoneypotChannel(config.guild_id, channel.channel_id);
                        } else if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                            console.log(styleText("dim", `Channel recreate experiment execution failed: ${err}`));
                        } else {
                            console.log(`Channel recreate experiment execution failed: ${err}`);
                        }

                        await api.channels.createMessage(config.log_channel_id || channel.channel_id, {
                            content: `⚠️ There was a problem recreating the <#${channel.channel_id}> channel for the "Channel Recreate" experiment. Please check my permissions - A common issue is permission overwrites that the bot may not have to create itself as a member.`,
                            allowed_mentions: {},
                        }).catch(err => {
                            const discordErrorCode = err instanceof DiscordAPIError ? err.code : null;
                            if (discordErrorCode === RESTJSONErrorCodes.MissingAccess || discordErrorCode === RESTJSONErrorCodes.MissingPermissions) {
                                console.log(styleText("dim", `Failed to send failed message for channel recreate experiment: ${err}`));
                            } else if (config.log_channel_id && discordErrorCode === RESTJSONErrorCodes.UnknownChannel) {
                                db.unsetLogChannel(config.guild_id, config.log_channel_id);
                                console.log(styleText("dim", `Failed to send failed message for channel recreate experiment: ${err}`));
                            } else {
                                console.log(`Failed to send failed message for channel recreate experiment: ${err}`);
                            }
                        });
                    }
                }

                if (redis && channels.length > 0) {
                    const channels = await db.getChannels(config.guild_id);
                    setSubscribedChannelCache(config.guild_id, channels.map(c => c.channel_id), redis);
                }

            }
        }

        await Promise.allSettled([
            channelWarmer(),
            randomChannelName(),
            channelRecreate(),
        ]);
    },
};

export default cron;
