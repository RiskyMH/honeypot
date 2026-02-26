import { Client } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import { GatewayIntentBits, PresenceUpdateStatus, ActivityType, GatewayDispatchEvents } from "discord-api-types/v10";
import { initDb } from "./utils/db";
import eventHandlers from "./events/events";
import { commandsPayload } from "./utils/commands";
import { runCron } from "./cron/experiments";
import initialPresence from "./utils/initial-presence";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
let applicationId = atob(process.env.DISCORD_TOKEN?.split(".")[0]!); // i bet most didn’t know this fact about discord tokens

process.title = "Honeypot Bot (riskymh.dev)";

await initDb();

process.on('uncaughtException', (err) => {
    console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

const rest = new REST({ version: "10" }).setToken(token);
const gateway = new WebSocketManager({
    token,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
    rest,
    shardCount: null,
    initialPresence,
});

const client = new Client({ rest, gateway });

for (const event of eventHandlers) {
    client.on(event.event, async (data: any) => {
        try {
            // @ts-expect-error - types are weird
            await event.handler({ data: data.data, api: data.api, applicationId });
        } catch (err) {
            console.error(`Error handling event ${event.event}:`, err);
        }
    });
}

client.once(GatewayDispatchEvents.Ready, (c) => {
    console.info(`[Shard ${c.shardId}] ${c.data.user.username}#${c.data.user.discriminator} is ready!`);
    applicationId = c.data.user.id;
    

    c.api.applicationCommands.bulkOverwriteGlobalCommands(c.data.user.id, commandsPayload);
});

gateway.connect();

runCron(client.api);
