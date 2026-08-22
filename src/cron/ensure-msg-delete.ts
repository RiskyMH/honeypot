// see https://github.com/discord/discord-api-docs/issues/8360
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
const MAX_ENTRY_AGE = 24 * 60 * 60 * 1000;

let running = false;

function timestampToSnowflake(ts: number): string {
    return ((BigInt(ts) - DISCORD_EPOCH) << 22n).toString();
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

            const now = Date.now();
            const minAge = now - NINETY_SECONDS;
            const guildEntries = new Map<string, Map<string, number>>();
            const toRemove = new Set(entries);

            for (const entry of entries) {
                const [tsStr, userId, ...guildIdParts] = entry.split(":");
                if (!tsStr || !userId) continue;
                const ts = parseInt(tsStr, 10);
                if (isNaN(ts) || now - ts > MAX_ENTRY_AGE) continue;
                if (ts > minAge) {
                    toRemove.delete(entry);
                    continue;
                }

                const guildId = guildIdParts.join(":");
                let userMap = guildEntries.get(guildId);
                if (!userMap) {
                    userMap = new Map();
                    guildEntries.set(guildId, userMap);
                }
                const existing = userMap.get(userId);
                if (!existing || ts > existing) userMap.set(userId, ts);
            }

            let totalDeleted = 0;
            let totalFound = 0;

            for (const [guildId, userMap] of guildEntries) {
                const config = await db.getConfig(guildId);
                if (!config?.experiments?.includes("ensure-msg-delete")) continue;

                let minTs = Infinity;
                let maxTs = -Infinity;
                const userMaxSnowflakes = new Map<string, string>();
                for (const [userId, ts] of userMap) {
                    if (ts < minTs) minTs = ts;
                    if (ts > maxTs) maxTs = ts;
                    userMaxSnowflakes.set(userId, timestampToSnowflake(ts));
                }

                const minSnowflake = timestampToSnowflake(minTs - TEN_MINUTES);
                const maxSnowflake = timestampToSnowflake(maxTs);
                const userIds = [...userMap.keys()];

                for (let i = 0; i < userIds.length; i += MAX_AUTHOR_IDS) {
                    const batch = userIds.slice(i, i + MAX_AUTHOR_IDS);
                    const channelMessages = new Map<string, string[]>();

                    let offset = 0;
                    while (true) {
                        const query: RESTGetAPIGuildMessagesSearchQuery = {
                            author_id: batch,
                            min_id: minSnowflake,
                            max_id: maxSnowflake,
                            offset,
                            limit: SEARCH_LIMIT,
                            include_nsfw: true,
                        };

                        try {
                            const result = await searchForMessages(api, guildId, query);
                            if (!result || !("total_results" in result)) break;

                            for (const msgs of result.messages ?? []) {
                                for (const { channel_id, id, author } of msgs) {
                                    const userMax = userMaxSnowflakes.get(author.id);
                                    if (!userMax || id > userMax) continue;
                                    let ids = channelMessages.get(channel_id);
                                    if (!ids) {
                                        ids = [];
                                        channelMessages.set(channel_id, ids);
                                    }
                                    ids.push(id);
                                    totalFound++;
                                }
                            }

                            offset += SEARCH_LIMIT;
                            if (offset >= result.total_results) break;
                        } catch (err) {
                            if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.MissingAccess || err.code === RESTJSONErrorCodes.MissingPermissions)) {
                                console.log(styleText("dim", `[ensure-msg-delete] Missing perms to search guild, skipping... ${err}`));
                            } else {
                                console.log(`[ensure-msg-delete] Search failed for guild: ${err}`);
                            }
                            break;
                        }
                    }

                    for (const [channelId, msgIds] of channelMessages) {
                        for (let j = 0; j < msgIds.length; j += BULK_DELETE_MAX) {
                            const toDelete = msgIds.slice(j, j + BULK_DELETE_MAX);
                            try {
                                if (toDelete.length === 1) {
                                    await api.channels.deleteMessage(channelId, toDelete[0]!, { reason: "Ensure message delete experiment" });
                                } else {
                                    await api.channels.bulkDeleteMessages(channelId, toDelete, { reason: "Ensure message delete experiment" });
                                }
                                totalDeleted += toDelete.length;
                            } catch (err) {
                                const code = err instanceof DiscordAPIError ? err.code : null;
                                if (code === RESTJSONErrorCodes.UnknownMessage) {
                                    console.log(styleText("dim", `[ensure-msg-delete] Message already deleted: ${err}`));
                                } else if (code === RESTJSONErrorCodes.MissingAccess || code === RESTJSONErrorCodes.MissingPermissions) {
                                    console.log(styleText("dim", `[ensure-msg-delete] Delete failed: ${err}`));
                                } else {
                                    console.log(`[ensure-msg-delete] Delete failed: ${err}`);
                                }
                            }
                        }
                    }
                }

                await Bun.sleep(500);
            }

            if (totalFound > 0) {
                console.log(`[ensure-msg-delete] Force deleted ${totalDeleted === totalFound ? totalFound : `${totalDeleted}/${totalFound}`} messages (${guildEntries.size} guilds)`);
            }

            if (toRemove.size > 0) {
                await removeFromEnsureMsgDeleteQueue([...toRemove], redis);
            }
        } finally {
            running = false;
        }
    },
};

export default cron;
