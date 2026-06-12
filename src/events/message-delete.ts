import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { setSubscribedChannelCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.MessageDelete> = {
    event: GatewayDispatchEvents.MessageDelete,
    handler: async ({ data: message, api, applicationId, redis, db }) => {
        if (!message.guild_id) return;
        try {
            await db.unsetHoneypotMsg(message.guild_id, message.id);

            // same thing as in message-create, if we have a proxy ws and the deleted message is not in a honeypot channel,
            // we should still cache that this is not the right channel so we dont get unnessary spam
            if (process.env.HAS_PROXY_WS && redis && message.guild_id) {
                const result = await db.getConfigWithChannels(message.guild_id);
                if (!result) return;
                const { config, channels } = result;
                if (!config || !config.action) return;
                if (channels.some(c => c.channel_id === message.channel_id)) return;
                const ids = channels.map(c => c.channel_id);
                setSubscribedChannelCache(message.guild_id, ids.length > 0 ? ids : ["none"], redis);
            }

        } catch (err) {
            console.error(`Error with MessageDelete handler: ${err}`);
        }
    }
};

export default handler;
