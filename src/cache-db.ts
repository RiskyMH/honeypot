import { SQL } from "bun";

// MessageCacheEntry represents a message to be tracked for deletion
export type MessageCacheEntry = {
  guild_id: string;
  channel_id: string;
  message_id: string;
  user_id: string;
  timestamp: number; // ms since epoch
};

export const db = new SQL(process.env.CACHE_DB_URL || ":memory:");

export async function initCacheDb() {
  await db`
    CREATE TABLE IF NOT EXISTS message_cache (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `;
}

export async function addMessageToCache(entry: MessageCacheEntry) {
  await db`
    INSERT OR REPLACE INTO message_cache (guild_id, channel_id, message_id, user_id, timestamp)
    VALUES (${entry.guild_id}, ${entry.channel_id}, ${entry.message_id}, ${entry.user_id}, ${entry.timestamp})
  `;
}

export async function getRecentMessagesForUser(guild_id: string, user_id: string, since: number): Promise<MessageCacheEntry[]> {
  return await db`
    SELECT * FROM message_cache WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND timestamp >= ${since}
  `;
}

export async function deleteOldMessages(olderThan: number) {
  await db`
    DELETE FROM message_cache WHERE timestamp < ${olderThan}
  `;
}

export async function deleteGuildFromMessages(guild_id: string) {
  await db`
    DELETE FROM message_cache WHERE guild_id = ${guild_id}
  `;
}

export async function deleteMessageFromCache(message_id: string) {
  await db`
    DELETE FROM message_cache WHERE message_id = ${message_id}
  `;
}

initCacheDb();

const oneHr = 60 * 60 * 1000;
setInterval(() => deleteOldMessages(Date.now() - oneHr), oneHr);
