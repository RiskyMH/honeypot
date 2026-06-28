import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { GuildFeature } from "discord-api-types/v10";

const yearSeconds = 365 * 24 * 60 * 60;

interface GuildInfo { name: string, ownerId: string, isDiscoverable?: boolean; }
const guildCache = new Map<string, GuildInfo>();

export const getGuildInfo = async (api: API | API2, guildId: string, signal?: AbortSignal, redis?: Bun.RedisClient): Promise<GuildInfo> => {
  if (redis) {
    const cached = await redis.hget("guild_info", guildId);
    if (cached) return JSON.parse(cached);
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info: GuildInfo = { name: guild.name, ownerId: guild.owner_id, isDiscoverable: guild.features.includes(GuildFeature.Discoverable) ? true : undefined };
    await redis.hsetex("guild_info", "EX", yearSeconds, "FIELDS", 1, guildId, JSON.stringify(info));
    return info;
  } else {
    if (guildCache.has(guildId)) return guildCache.get(guildId)!;
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info: GuildInfo = { name: guild.name, ownerId: guild.owner_id, isDiscoverable: guild.features.includes(GuildFeature.Discoverable) ? true : undefined };
    guildCache.set(guildId, info);
    return info;
  }
};
export const setGuildInfoCache = (guildId: string, info: GuildInfo, redis?: Bun.RedisClient) => {
  if (redis) {
    const cacheStr = JSON.stringify({ name: info.name, ownerId: info.ownerId, isDiscoverable: info.isDiscoverable ? true : undefined });
    redis.hsetex("guild_info", "EX", yearSeconds, "FIELDS", 1, guildId, cacheStr);
  } else {
    guildCache.set(guildId, info);
  }
  return info;
}
export const invalidateGuildInfoCache = (guildId: string, redis?: Bun.RedisClient) => {
  if (redis) {
    redis.hdel("guild_info", guildId);
  } else {
    guildCache.delete(guildId);
  }
}

const threeDaysSeconds = 3 * 24 * 60 * 60;

export const setDmChannelCache = (userId: string, channelId: string, redis: Bun.RedisClient) => {
  redis.hsetex("user_dm_channel", "EX", threeDaysSeconds, "FIELDS", 1, userId, channelId);
}
export const getDmChannelCache = (userId: string, redis: Bun.RedisClient) => {
  return redis.hget("user_dm_channel", userId);
}

const daySeconds = 24 * 60 * 60;
export const setSubscribedChannelCache = (guildId: string, channelIds: string[], redis: Bun.RedisClient) => {
  redis.hsetex("discord_ws_config:guild-channels", "EX", daySeconds, "FIELDS", 1, guildId, channelIds.join(","));
}
export const getSubscribedChannelCache = async (guildId: string, redis: Bun.RedisClient) => {
  const channels = await redis.hget("discord_ws_config:guild-channels", guildId);
  if (!channels) return null;
  return channels.split(",");
}
export const removeGuildSubscribedChannelCache = (guildId: string, redis: Bun.RedisClient) => {
  redis.hdel("discord_ws_config:guild-channels", guildId);
}


// to delete messages (from sending nice into msg in honeypot channel) to ensure its cleaned up even cross-restarts
export const addToDeleteMessageCache = (channelId: string, messageId: string, redis: Bun.RedisClient) => {
  return redis.sadd("delete_message", `${channelId}:${messageId}`);
}
export const getDeleteMessageCache = async (redis: Bun.RedisClient) => {
  const entries = await redis.smembers("delete_message");
  return entries.map(e => {
    const [channelId, messageId] = e.split(":");
    return { channelId, messageId };
  });
}
export const removeFromDeleteMessageCache = (channelId: string, messageId: string, redis: Bun.RedisClient) => {
  return redis.srem("delete_message", `${channelId}:${messageId}`);
}

// set command cache
let commandIdMapCache = null as null | Record<string, string>;
export const setCommandIdCache = (commandIdMap: Record<string, string>, redis?: Bun.RedisClient | null) => {
  if (redis) {
    redis.set("command_id_map", JSON.stringify(commandIdMap));
  } else {
    commandIdMapCache = commandIdMap;
  }
}
export const getCommandIdCache = async (redis?: Bun.RedisClient | null) => {
  if (!redis) return commandIdMapCache;
  const raw = await redis.get("command_id_map");
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, string>;
}
export const invalidateCommandIdCache = (redis: Bun.RedisClient | null) => {
  redis?.del("command_id_map");
  commandIdMapCache = null;
}

// set is already moderating (used when many channels exist and we want to avoid multiple moderations for same user at same time)
export const setIsAlreadyModerating = (guildId: string, userId: string, redis: Bun.RedisClient) => {
  redis.hsetex("is_moderating", "EX", 30, "FIELDS", 1, `${guildId}:${userId}`, "true");
}
export const getIsAlreadyModerating = (guildId: string, userId: string, redis: Bun.RedisClient) => {
  return redis.hexists("is_moderating", `${guildId}:${userId}`);
}
export const unsetIsAlreadyModerating = (guildId: string, userId: string, redis: Bun.RedisClient) => {
  redis.hdel("is_moderating", `${guildId}:${userId}`);
}

// weird cache to try to ensure all messages are deleted
const ensureMsgDeleteQueue = new Set<string>();
export const addToEnsureMsgDeleteQueue = (userId: string, guildId: string, redis?: Bun.RedisClient, timestamp?: number, justMonitor = false) => {
  const entry = `${timestamp ?? Date.now()}:${userId}:${guildId}${justMonitor ? ":monitor" : ""}`;
  if (redis) {
    return redis.sadd("ensure-msg-delete", entry);
  }
  ensureMsgDeleteQueue.add(entry);
}

export const getEnsureMsgDeleteQueue = async (redis?: Bun.RedisClient): Promise<string[]> => {
  if (redis) {
    return redis.smembers("ensure-msg-delete");
  }
  return [...ensureMsgDeleteQueue];
}

export const removeFromEnsureMsgDeleteQueue = (entries: string[], redis?: Bun.RedisClient) => {
  if (redis && entries.length > 0) {
    return redis.srem("ensure-msg-delete", ...entries);
  } else if (!redis) {
    for (const entry of entries) {
      ensureMsgDeleteQueue.delete(entry);
    }
  }
}
