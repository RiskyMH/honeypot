import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { unsetHoneypotMsgs } from "../utils/db";

const handler: EventHandler<GatewayDispatchEvents.MessageDeleteBulk> = {
    event: GatewayDispatchEvents.MessageDeleteBulk,
    handler: async ({ data: messageBatch, api, applicationId }) => {
        if (!messageBatch.guild_id) return;
        try {
            await unsetHoneypotMsgs(messageBatch.guild_id, messageBatch.ids);
        } catch (err) {
            console.error(`Error with MessageDeleteBulk handler: ${err}`);
        }
    }
};

export default handler;
