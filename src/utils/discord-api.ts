import type { API, RESTGetAPIGuildRoleMemberCountsResult, Snowflake } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { makeURLSearchParams, type RequestData } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import type { RESTGetAPIGuildMessagesSearchQuery, RESTGetAPIGuildMessagesSearchResult } from "discord-api-types/v10";

/**
 * Fetches role member counts for a guild.
 *
 * @see {@link https://discord.com/developers/docs/resources/guild#get-guild-role-member-counts}
 * @param api - The API instance to use for the request
 * @param guildId - The id of the guild to fetch role member counts for
 * @param options - The options for fetching role member counts
 */
export async function getRoleMemberCounts(api: API | API2, guildId: Snowflake, { auth, signal }: Pick<RequestData, 'auth' | 'signal'> = {}) {
    return api.rest.get(Routes.guildRoleMemberCounts(guildId), {
        auth,
        signal,
    }) as Promise<RESTGetAPIGuildRoleMemberCountsResult>;
}

/**
 * Searches for messages.
 *
 * @see {@link https://docs.discord.com/developers/resources/message#search-guild-messages}
 * @param guildId - The id of the guild to search in
 * @param query - The query to search for
 * @param options - The options for searching for messages
 */
export async function searchForMessages(
    api: API | API2,
    guildId: Snowflake,
    query: RESTGetAPIGuildMessagesSearchQuery,
    { auth, signal }: Pick<RequestData, 'auth' | 'signal'> = {},
) {
    return api.rest.get(Routes.guildMessagesSearch(guildId), {
        auth,
        query: makeURLSearchParams(query),
        signal,
    }) as Promise<RESTGetAPIGuildMessagesSearchResult>;
}
