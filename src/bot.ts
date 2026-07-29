import { Client } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import { GatewayIntentBits, GatewayDispatchEvents, type RESTGetAPIGatewayBotResult, Routes } from "discord-api-types/v10";
import * as db from "./utils/db";
import eventHandlers from "./events/events";
import { commandsPayload } from "./utils/commands";
import { runCrons } from "./cron/crons";
import initialPresence from "./utils/initial-presence";
import { setCommandIdCache } from "./utils/cache";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
let applicationId = atob(token.split(".")[0]!); // i bet most didn’t know this fact about discord tokens

process.title = "Honeypot Bot (riskymh.dev)";

await db.initDb();
const redis = process.env.REDIS_URL ? new Bun.RedisClient(process.env.REDIS_URL) : null;

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
    fetchGatewayInformation: () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
    shardCount: null,
    initialPresence,
});

const client = new Client({ rest, gateway });

for (const event of eventHandlers) {
    client.on(event.event, async (data: any) => {
        try {
            // @ts-expect-error - types are weird
            await event.handler({ data: data.data, api: data.api, applicationId, redis, db });
        } catch (err) {
            console.error(`Error handling event ${event.event}:`, err);
        }
    });
}

client.on(GatewayDispatchEvents.Ready, (c) => {
    console.info(`[Shard ${c.shardId}] ${c.data.user.username}#${c.data.user.discriminator} is ready!`);
    applicationId = c.data.user.id;

    c.api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, commandsPayload).then((cmds) => {
        const commandIdMap = cmds.reduce((acc, cmd) => { acc[cmd.name] = cmd.id; return acc; }, {} as Record<string, string>);
        setCommandIdCache(commandIdMap, redis)
    });
});

gateway.connect();

runCrons(client.api, db, redis || undefined);
