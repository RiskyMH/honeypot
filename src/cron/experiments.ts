import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { MessageFlags } from "discord-api-types/v10";
import randomChannelNames from "../utils/random-channel-names.yaml";
import { CUSTOM_EMOJI } from "../utils/constants";
import { getGuildsWithExperiment } from "../utils/db";


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



function runAtMidnightUTC(fn: () => void) {
    const now = new Date();
    const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const msToMidnight = nextMidnightUTC.getTime() - now.getTime();
    setTimeout(() => {
        fn();
        setInterval(fn, 24 * 60 * 60 * 1000); // every 24h after first run
    }, msToMidnight);
}


export const runCron = (api: API | API2) => runAtMidnightUTC(async () => {
    // intentionally only run one at a time with delay to avoid rate limits (as least important feature)

    // channel warmer experiment - send a msg and instantly delete it to keep channel active
    const channelWarmer = async () => {
        const guilds = await getGuildsWithExperiment("channel-warmer");
        const configs = guilds.filter(config => !!config?.honeypot_channel_id);
        for (const config of configs) {
            try {
                await channelWarmerExperiment(api, config.guild_id, config.honeypot_channel_id!);
                await Bun.sleep(1_000);
            } catch (err) {
                console.log(`Channel warmer experiment execution failed: ${err}`);
                await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id!, {
                    content: `There was a problem sending a message to the <#${config.honeypot_channel_id}> channel for the "Channel Warmer" experiment. Please check my permissions.`,
                    allowed_mentions: {},
                });
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
                    api,
                    config.guild_id,
                    config.honeypot_channel_id!,
                    config.experiments.includes("random-channel-name-chaos")
                )
                await Bun.sleep(1_000);
            } catch (err) {
                console.log(`Random channel name experiment execution failed: ${err}`);
                await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id!, {
                    content: `There was a problem updating the <#${config.honeypot_channel_id}> channel for the "Random Channel Name" experiment. Please check my permissions.`,
                    allowed_mentions: {},
                });
            }
        }
    };

    await Promise.all([
        channelWarmer(),
        randomChannelName(),
    ]);
});
