import type { GatewayDispatchEvents, GatewayDispatchPayload } from "discord-api-types/v10";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";


export type EventHandler<K extends GatewayDispatchEvents = GatewayDispatchEvents> = {
    event: K,
    handler: (listener: {
        data: (Extract<GatewayDispatchPayload, { t: K }>["d"]),
        api: API | API2,
        applicationId: string
    }) => Promise<any>;
};



import guildCreate from "./guild-create";
import guildDelete from "./guild-delete";
import guildUpdate from "./guild-update";
import channelDelete from "./channel-delete";
import messageDelete from "./message-delete";
import messageDeleteBulk from "./message-delete-bulk";
import messageCreate from "./message-create";
import interactionCreate from "./interaction-create";

export const eventHandlers = [
    guildCreate,
    guildDelete,
    guildUpdate,
    channelDelete,
    messageDelete,
    messageDeleteBulk,
    messageCreate,
    interactionCreate,
]

export default eventHandlers;
