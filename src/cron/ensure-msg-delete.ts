import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { DiscordAPIError } from "@discordjs/rest";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { RESTGetAPIGuildMessagesSearchQuery } from "discord-api-types/v10";
import { searchForMessages } from "../utils/discord-api";
import { getEnsureMsgDeleteQueue, removeFromEnsureMsgDeleteQueue } from "../utils/cache";
import type { Cron } from "./crons";
import { styleText } from "node:util";

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
            .catch(handleDeleteError);
        return;
    }

    for (let i = 0; i < msgIds.length; i += BULK_DELETE_MAX) {
        const batch = msgIds.slice(i, i + BULK_DELETE_MAX);
        await api.channels.bulkDeleteMessages(channelId, batch, { reason: "Ensure message delete experiment" })
            .catch(handleDeleteError);
    }
}

function handleDeleteError(err: unknown) {
    const discordError = err instanceof DiscordAPIError ? err : null;
    if (discordError?.code === RESTJSONErrorCodes.UnknownMessage) {
        console.log(styleText("dim", `[ensure-msg-delete] Message already deleted: ${err}`));
        return;
    } else if (discordError?.code === RESTJSONErrorCodes.MissingAccess || discordError?.code === RESTJSONErrorCodes.MissingPermissions) {
        console.log(styleText("dim", `[ensure-msg-delete] Delete failed: ${err}`));
        return;
    }
    console.log(`[ensure-msg-delete] Delete failed: ${err}`);
}

function parseQueueEntry(entry: string, minAge: number): { userId: string; ts: number; guildId: string; isMonitor: boolean } | null {
    const isMonitor = entry.endsWith(":monitor");
    const parts = isMonitor ? entry.slice(0, -8).split(":") : entry.split(":");
    const [tsStr, userId, ...guildIdParts] = parts;
    if (!tsStr || !userId) return null;
    const ts = parseInt(tsStr, 10);
    if (ts > minAge) return null;
    return { userId, ts, guildId: guildIdParts.join(":"), isMonitor };
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
            const deleteMap = new Map<string, Map<string, number>>();
            const monitorMap = new Map<string, Map<string, number>>();
            const entryGuildMap = new Map<string, string>();
            let totalDeleted = 0;
            let totalMonitorFound = 0;
            for (const entry of entries) {
                const parsed = parseQueueEntry(entry, minAge);
                if (!parsed) continue;
                entryGuildMap.set(entry, parsed.guildId);
                const { userId, ts, guildId, isMonitor } = parsed;
                const map = isMonitor ? monitorMap : deleteMap;
                let userMap = map.get(guildId);
                if (!userMap) {
                    userMap = new Map();
                    map.set(guildId, userMap);
                }
                const existing = userMap.get(userId);
                if (!existing || ts > existing) userMap.set(userId, ts);
            }
            if (deleteMap.size === 0 && monitorMap.size === 0) return;

            const successfulGuildIds = new Set<string>();
            const allGuildIds = new Set([...deleteMap.keys(), ...monitorMap.keys()]);
            for (const guildId of allGuildIds) {
                const config = await db.getConfig(guildId);
                if (!config) {
                    successfulGuildIds.add(guildId);
                    continue;
                }
                // if (!config.experiments.includes("ensure-msg-delete")) continue;

                const deleteUserMap = deleteMap.get(guildId);
                const monitorUserMap = monitorMap.get(guildId);
                const allUserMaps = [deleteUserMap, monitorUserMap].filter(Boolean) as Map<string, number>[];

                let minTimestamp = Infinity;
                let maxTimestamp = -Infinity;
                for (const userMap of allUserMaps) {
                    for (const ts of userMap.values()) {
                        if (ts < minTimestamp) minTimestamp = ts;
                        if (ts > maxTimestamp) maxTimestamp = ts;
                    }
                }

                const minSnowflake = timestampToSnowflake(minTimestamp - TEN_MINUTES);
                const maxSnowflake = timestampToSnowflake(maxTimestamp);

                const allUserIds = [...new Set([...(deleteUserMap?.keys() ?? []), ...(monitorUserMap?.keys() ?? [])])];
                const userMaxSnowflakes = new Map<string, string>();
                for (const userMap of allUserMaps) {
                    for (const [userId, ts] of userMap) {
                        userMaxSnowflakes.set(userId, timestampToSnowflake(ts));
                    }
                }

                let hadSearchError = false;
                for (let i = 0; i < allUserIds.length; i += MAX_AUTHOR_IDS) {
                    const batch = allUserIds.slice(i, i + MAX_AUTHOR_IDS);
                    const deleteChannelMap = new Map<string, string[]>();
                    let monitorFoundInBatch = 0;

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
                                    if (!deleteUserMap?.has(msg.author.id)) {
                                        monitorFoundInBatch++;
                                        continue;
                                    }
                                    let ids = deleteChannelMap.get(msg.channel_id);
                                    if (!ids) {
                                        ids = [];
                                        deleteChannelMap.set(msg.channel_id, ids);
                                    }
                                    ids.push(msg.id);
                                    totalDeleted++;
                                }
                            }

                            offset += SEARCH_LIMIT;
                            hasMore = offset < totalResults;
                        } catch (err) {
                            hadSearchError = true;
                            console.log(`[ensure-msg-delete] Search failed for guild: ${err}`);
                            break;
                        }
                    }

                    totalMonitorFound += monitorFoundInBatch;

                    for (const [channelId, msgIds] of deleteChannelMap) {
                        try {
                            await deleteMessages(api, channelId, msgIds, guildId);
                        } catch (err) {
                            console.log(`[ensure-msg-delete] Delete failed: ${err}`);
                        }
                    }
                }

                if (!hadSearchError) successfulGuildIds.add(guildId);
                await Bun.sleep(500); // avoid rate limits as its only a minor background noise task
            }

            if (totalMonitorFound > 0 || totalDeleted > 0) {
                console.log(`[ensure-msg-delete] Force deleted ${totalDeleted} messages (${deleteMap.size} guilds), ${totalMonitorFound} messages left lingering (${monitorMap.size} guilds)`);
            }

            // Only remove entries from successfully processed guilds
            const processedEntries = entries.filter(e => {
                const guildId = entryGuildMap.get(e);
                return guildId && successfulGuildIds.has(guildId);
            });
            if (processedEntries.length > 0) {
                await removeFromEnsureMsgDeleteQueue(processedEntries, redis);
            }

            // Cleanup stale entries (older than 24h) that slipped through
            const MAX_ENTRY_AGE = 24 * 60 * 60 * 1000;
            const staleEntries = entries.filter(entry => {
                const colonIdx = entry.indexOf(":");
                if (colonIdx === -1) return true;
                const ts = parseInt(entry.slice(0, colonIdx), 10);
                return isNaN(ts) || Date.now() - ts > MAX_ENTRY_AGE;
            });
            if (staleEntries.length > 0) {
                await removeFromEnsureMsgDeleteQueue(staleEntries, redis);
            }
        } finally {
            running = false;
        }
    },
};

export default cron;
