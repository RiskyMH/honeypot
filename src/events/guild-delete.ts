import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { deleteConfig } from "../utils/db";
import { guildCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildDelete> = {
    event: GatewayDispatchEvents.GuildDelete,
    handler: async ({ data: guild, api, applicationId }) => {
        try {
            if (guild.unavailable === true) return;
            await deleteConfig(guild.id);
            guildCache.delete(guild.id);
        } catch (err) {
            console.error(`Failed to delete honeypot config for guild ${guild.id}:`, err);
        }
    }
};

export default handler;
