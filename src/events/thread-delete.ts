import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";

const handler: EventHandler<GatewayDispatchEvents.ThreadDelete> = {
    event: GatewayDispatchEvents.ThreadDelete,
    handler: async ({ data: thread, api, applicationId, redis, db }) => {
        const { guild_id: guildId, id: channelId } = thread;
        if (!guildId) return;
        try {
            await db.unsetHoneypotChannel(guildId, channelId);
            await db.unsetLogChannel(guildId, channelId);
            await db.unsetWebhookThread(guildId, channelId);
        } catch (err) {
            console.error(`Error with ThreadDelete handler: ${err}`);
        }
    }
};

export default handler;
