import { GatewayDispatchEvents, type GatewayDispatchPayload } from "discord-api-types/v10";
import eventHandlers from "../events/events";
import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import * as db from "../utils/db";
import { runCrons } from "../cron/crons";
import { commandsPayload } from "../utils/commands";
import { setCommandIdCache } from "../utils/cache";


const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL environment variable not set.");
let applicationId = atob(process.env.DISCORD_TOKEN?.split(".")[0]!); // i bet most didn’t know this fact about discord tokens

process.title = "Honeypot Bot (riskymh.dev) - Event Handler Worker";
process.env.HAS_PROXY_WS = "true";
await db.initDb();

process.on('uncaughtException', (err) => {
    console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('SIGTERM', () => {
    console.log("Received SIGTERM, shutting down...");
    runLoop = false;
    redisBlocking.close();
});

const getRedis = (c?: Bun.RedisOptions) => new Bun.RedisClient(process.env.REDIS_URL!, c);
const redis = getRedis();
// separate connection for blocking so it doesnt interfere with the main one
const redisBlocking = getRedis({ connectionTimeout: 1000, maxRetries: 1 });
const redisPubSub = getRedis();

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
const api = new API(rest);

let runLoop = true;
let currentlyRunning = 0

const listen = async () => {
    const wsConfig = JSON.stringify({
        events: Object.keys(eventMap),
        messageEvents: { sendBotEvents: false },
    })
    redis.set("discord_ws_config", wsConfig)
    redis.publish("discord_ws_config", wsConfig)

    while (runLoop) try {
        if (currentlyRunning > 1000) {
            console.warn(`Currently running ${currentlyRunning} event handlers, waiting 100ms to hopefully not infinitely overload server...`);
            await Bun.sleep(100);
        } else if (currentlyRunning > 500) {
            console.warn(`Currently running ${currentlyRunning} event handlers, waiting 10ms to hopefully not infinitely overload server...`);
            await Bun.sleep(10);
        }

        const rawEvent = (await redisBlocking.blpop("discord_events", 0));
        if (!rawEvent) continue;
        const event = JSON.parse(rawEvent[1]) as GatewayDispatchPayload;
        if (!event) continue;

        const handler = eventMap[event.t as GatewayDispatchEvents];
        if (handler) {
            for (const h of handler) {
                currentlyRunning++;
                (async () => {
                    try {
                        // @ts-expect-error - types are weird
                        await h({ data: event.d, api, applicationId, redis, db });
                    } catch (err) {
                        console.error(`Error handling event ${event.t}:`, err);
                    } finally {
                        currentlyRunning--;
                    }
                })();
            }
        } else {
            console.error("Event not handled:", event.t);
        }
    } catch (err) {
        console.error("Error in event handler loop:", err);
    }

    console.log("Loop stopped. Waiting for remaining handlers...");

    while (currentlyRunning > 0) await Bun.sleep(100);
    await rest.waitForAllListenersToComplete();

    console.log("All clear. Exiting.");
    process.exit(0);
};


function getEventMap() {
    const eventMap = {} as {
        [K in GatewayDispatchEvents]: ((
            listener: { data: (Extract<GatewayDispatchPayload, { t: K }>["d"]), api: API, applicationId: string, redis: Bun.RedisClient, db: typeof import("../utils/db") }
        ) => Promise<void> | void)[];
    };
    for (const event of eventHandlers) {
        eventMap[event.event] ||= []
        // @ts-expect-error - types are weird
        eventMap[event.event].push(event.handler);
    }
    return eventMap;
}

const eventMap = getEventMap();

listen();
console.log("Event handler worker started.");

// todo: consider this better because if this has replicas, then each instance will run the cron...
if (process.env.REPLICA_ID === "1" || !process.env.REPLICA_ID) {
    // redisPubSub.subscribe("", async (message) => {});
    runCrons(api, db, redis);
    api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, commandsPayload).then((cmds) => {
        const commandIdMap = cmds.reduce((acc, cmd) => { acc[cmd.name] = cmd.id; return acc; }, {} as Record<string, string>);
        setCommandIdCache(commandIdMap, redis)
    });
}
