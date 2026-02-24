import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { unsetLogChannel } from "../utils/db";
import { unsetHoneypotChannel } from "../utils/db";

const handler: EventHandler<GatewayDispatchEvents.ChannelDelete> = {
    event: GatewayDispatchEvents.ChannelDelete,
    handler: async ({ data: channel, api, applicationId }) => {
        const { guild_id: guildId, id: channelId } = channel;
        if (!guildId) return;
        try {
            await unsetHoneypotChannel(guildId, channelId);
            await unsetLogChannel(guildId, channelId);
        } catch (err) {
            console.error(`Error with ChannelDelete handler: ${err}`);
        }
    }
};

export default handler;
