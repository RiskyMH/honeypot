import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { guildCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildUpdate> = {
    event: GatewayDispatchEvents.GuildUpdate,
    handler: async ({ data: guild, api, applicationId }) => {
        guildCache.set(guild.id, { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code });
    }
};

export default handler;
