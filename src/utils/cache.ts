import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

export const guildCache = new Map<string, { name: string, ownerId: string, vanityInviteCode: string | null }>();
export const getGuildInfo = async (api: API | API2, guildId: string, signal?: AbortSignal) => {
  if (guildCache.has(guildId)) return guildCache.get(guildId)!;
  const guild = await api.guilds.get(guildId, undefined, { signal });
  const info = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || null };
  guildCache.set(guildId, info);
  return info;
};
