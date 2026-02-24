import { GatewayDispatchEvents, type GatewayDispatchPayload } from "discord-api-types/v10";
import eventHandlers from "../events/events";
import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { initDb } from "../utils/db";
import { runCron } from "../cron/experiments";
import { commandsPayload } from "../utils/commands";


const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN environment variable not set.");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL environment variable not set.");
let applicationId = atob(process.env.DISCORD_TOKEN?.split(".")[0]!); // i bet most didn’t know this fact about discord tokens

process.title = "Honeypot Bot (riskymh.dev) - Event Handler Worker";

await initDb();

process.on('uncaughtException', (err) => {
    console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});



const redis = Bun.redis;
const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
const api = new API(rest);

let currentlyRunning = 0

const listen = async () => {
    const eventsListening = Object.keys(eventMap);
    const wsConfig = JSON.stringify({
        events: eventsListening,
        messageEvents: { sendBotEvents: false }
    })
    redis.set("discord_ws_config", wsConfig)
    redis.lpush("discord_ws_config_", wsConfig)

    while (1) {
        if (currentlyRunning > 50) {
            console.warn(`Currently running ${currentlyRunning} event handlers, waiting 300ms to hopefully not infinitely overload server...`);
            await Bun.sleep(300);
            // continue;
        }
        const rawEvent = (await redis.blpop("discord_events", 0));
        if (!rawEvent) continue;
        const event = JSON.parse(rawEvent[1]) as GatewayDispatchPayload;

        if (event) {
            const handler = eventMap[event.t as GatewayDispatchEvents];
            if (handler) {
                for (const h of handler) {
                    currentlyRunning++;
                    (async () => {
                        try {
                            // @ts-expect-error - types are weird
                            await h({ data: event.d, api, applicationId });
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
        }
    }
};


function getEventMap() {
    const eventMap = {} as {
        [K in GatewayDispatchEvents]: ((
            listener: { data: (Extract<GatewayDispatchPayload, { t: K }>["d"]), api: API, applicationId: string }
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

// todo: consider this better because if this has replicas, then each instance will run the cron...
if (process.env.REPLICA_ID === "1" || !process.env.REPLICA_ID) {
    runCron(api);
    api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, commandsPayload);
}