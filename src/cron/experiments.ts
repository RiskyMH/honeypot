import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { MessageFlags, RESTJSONErrorCodes } from "discord-api-types/v10";
import randomChannelNames from "../utils/random-channel-names.yaml";
import { CUSTOM_EMOJI } from "../utils/constants";
import type { Cron } from "./crons";
import { DiscordAPIError } from "@discordjs/rest";
import { styleText } from "node:util";


export async function channelWarmerExperiment(api: API | API2, guildId: string, channelId: string) {
    const msg = await api.channels.createMessage(
        channelId,
        {
            content: `Keeping the honeypot channel active! ${CUSTOM_EMOJI}`,
            allowed_mentions: {},
            flags: MessageFlags.SuppressNotifications,
        }
    );
    await Bun.sleep(50);
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


const cron: Cron = {
    name: "Experiment Runner",
    frequency: "@daily",
    run: async (api, db) => {
        // intentionally only run one at a time with delay to avoid rate limits (as least important feature)

        // channel warmer experiment - send a msg and instantly delete it to keep channel active
        const channelWarmer = async () => {
            const guilds = await db.getGuildsWithExperiment("channel-warmer");
            for (const config of guilds) {
                const channels = await db.getChannels(config.guild_id);
                for (const channel of channels) {
                    try {
                        await Bun.sleep(1_000);
                        await channelWarmerExperiment(api, config.guild_id, channel.channel_id);
                    } catch (err) {
                        console.log(`Channel warmer experiment execution failed: ${err}`);
                        await api.channels.createMessage(config.log_channel_id || channel.channel_id, {
                            content: `⚠️ There was a problem sending a message to the <#${channel.channel_id}> channel for the "Channel Warmer" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        }).catch(err => {
                            if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.MissingAccess || err.code === RESTJSONErrorCodes.MissingPermissions)) {
                                console.log(styleText("dim", `Failed to send failed message for channel warmer experiment: ${err}`));
                            } else {
                                console.log(`Failed to send failed message for channel warmer experiment: ${err}`);
                            }
                        });
                    }
                }
            }
        };

        // random channel name experiment - change the honeypot channel name to a random name
        const randomChannelName = async () => {
            const guilds = await db.getGuildsWithExperiment("random-channel-name");
            for (const config of guilds) {
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
                        console.log(`Random channel name experiment execution failed: ${err}`);
                        await api.channels.createMessage(config.log_channel_id || channel.channel_id, {
                            content: `⚠️ There was a problem updating the <#${channel.channel_id}> channel for the "Random Channel Name" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        }).catch(err => {
                            if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.MissingAccess || err.code === RESTJSONErrorCodes.MissingPermissions)) {
                                console.log(styleText("dim", `Failed to send failed message for random channel name experiment: ${err}`));
                            } else {
                                console.log(`Failed to send failed message for random channel name experiment: ${err}`);
                            }
                        });
                    }
                }
            }
        };

        await Promise.allSettled([
            channelWarmer(),
            randomChannelName(),
        ]);
    },
};

export default cron;
