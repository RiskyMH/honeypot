import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { DiscordAPIError } from "@discordjs/rest";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { RESTGetAPIGuildMessagesSearchQuery } from "discord-api-types/v10";
import { searchForMessages } from "../utils/discord-api";
import { getEnsureMsgDeleteQueue, removeFromEnsureMsgDeleteQueue } from "../utils/cache";
import type { Cron } from "./crons";

const NINETY_SECONDS = 90_000;
const TEN_MINUTES = 600_000;
const DISCORD_EPOCH = 1420070400000n;
const MAX_AUTHOR_IDS = 100;
const SEARCH_LIMIT = 25;
const BULK_DELETE_MAX = 100;

let running = false;

function timestampToSnowflake(ts: number): string {
    return ((BigInt(ts) - DISCORD_EPOCH) << 22n).toString();
}

async function deleteMessages(api: API | API2, channelId: string, msgIds: string[], guildId: string): Promise<void> {
    if (msgIds.length === 1) {
        await api.channels.deleteMessage(channelId, msgIds[0]!, { reason: "Ensure message delete experiment" })
            .catch(handleDeleteError(guildId));
        return;
    }

    for (let i = 0; i < msgIds.length; i += BULK_DELETE_MAX) {
        const batch = msgIds.slice(i, i + BULK_DELETE_MAX);
        await api.channels.bulkDeleteMessages(channelId, batch, { reason: "Ensure message delete experiment" })
            .catch(handleDeleteError(guildId));
    }
}

function handleDeleteError(guildId: string) {
    return (err: unknown) => {
        if (
            err instanceof DiscordAPIError &&
            (err.code === RESTJSONErrorCodes.UnknownMessage ||
             err.code === RESTJSONErrorCodes.MissingAccess ||
             err.code === RESTJSONErrorCodes.MissingPermissions)
        ) {
            return;
        }
        console.log(`[ensure-msg-delete] Delete failed in guild ${guildId}: ${err}`);
    };
}

const cron: Cron = {
    name: "Ensure Message Delete",
    frequency: "*/2 * * * *",
    run: async (api, db, redis) => {
        if (running) return;
        running = true;
        try {
            const entries = await getEnsureMsgDeleteQueue(redis);
            if (entries.length === 0) return;

            const minAge = Date.now() - NINETY_SECONDS;
            const guildMap = new Map<string, Map<string, number>>();
            const processedEntries: string[] = [];
            let totalDeleted = 0;
            for (const entry of entries) {
                const [tsStr, userId, ...guildIdParts] = entry.split(":");
                if (!tsStr || !userId) continue;
                const ts = parseInt(tsStr, 10);
                if (ts > minAge) continue;
                processedEntries.push(entry);
                const guildId = guildIdParts.join(":");
                let userMap = guildMap.get(guildId);
                if (!userMap) {
                    userMap = new Map();
                    guildMap.set(guildId, userMap);
                }
                const existing = userMap.get(userId);
                if (!existing || ts > existing) userMap.set(userId, ts);
            }
            if (guildMap.size === 0) return;

            for (const [guildId, userMap] of guildMap) {
                const config = await db.getConfig(guildId);
                if (!config || !config.experiments.includes("ensure-msg-delete")) continue;

                let minTimestamp = Infinity;
                let maxTimestamp = -Infinity;
                for (const ts of userMap.values()) {
                    if (ts < minTimestamp) minTimestamp = ts;
                    if (ts > maxTimestamp) maxTimestamp = ts;
                }

                const minSnowflake = timestampToSnowflake(minTimestamp - TEN_MINUTES);
                const maxSnowflake = timestampToSnowflake(maxTimestamp);

                const userIds = [...userMap.keys()];
                const userMaxSnowflakes = new Map<string, string>();
                for (const [userId, ts] of userMap) {
                    userMaxSnowflakes.set(userId, timestampToSnowflake(ts));
                }

                for (let i = 0; i < userIds.length; i += MAX_AUTHOR_IDS) {
                    const batch = userIds.slice(i, i + MAX_AUTHOR_IDS);
                    const channelMap = new Map<string, string[]>();

                    let offset = 0;
                    let hasMore = true;

                    while (hasMore) {
                        const query: RESTGetAPIGuildMessagesSearchQuery = {
                            author_id: batch,
                            min_id: minSnowflake,
                            max_id: maxSnowflake,
                            offset,
                            limit: SEARCH_LIMIT,
                        };

                        try {
                            const result = await searchForMessages(api, guildId, query);
                            if (!result || !("total_results" in result)) break;

                            const totalResults = result.total_results;
                            const channels = result.messages ?? [];

                            for (const msgs of channels) {
                                for (const msg of msgs) {
                                    const userMax = userMaxSnowflakes.get(msg.author.id);
                                    if (!userMax || msg.id > userMax) continue;
                                    let ids = channelMap.get(msg.channel_id);
                                    if (!ids) {
                                        ids = [];
                                        channelMap.set(msg.channel_id, ids);
                                    }
                                    ids.push(msg.id);
                                    totalDeleted++;
                                }
                            }

                            offset += SEARCH_LIMIT;
                            hasMore = offset < totalResults;

                            if (hasMore) await Bun.sleep(1_000);
                        } catch (err) {
                            console.log(`[ensure-msg-delete] Search failed for guild: ${err}`);
                            break;
                        }
                    }

                    for (const [channelId, msgIds] of channelMap) {
                        try {
                            await deleteMessages(api, channelId, msgIds, guildId);
                        } catch (err) {
                            console.log(`[ensure-msg-delete] Delete failed: ${err}`);
                        }
                        // await Bun.sleep(100);
                    }

                    // await Bun.sleep(1_000);
                }

                await Bun.sleep(1_000);
            }

            if (totalDeleted > 0) {
                console.log(`[ensure-msg-delete] Manually deleted ${totalDeleted} messages across ${guildMap.size} guilds`);
            }
            await removeFromEnsureMsgDeleteQueue(processedEntries, redis);
        } finally {
            running = false;
        }
    },
};

export default cron;
