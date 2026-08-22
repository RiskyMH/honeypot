import { WebSocketManager, WebSocketShardEvents, CompressionMethod, type SessionInfo } from '@discordjs/ws';
import { REST } from '@discordjs/rest';
import { GatewayDispatchEvents, GatewayIntentBits, Routes, type GatewayDispatchPayload, type RESTGetAPIGatewayBotResult } from 'discord-api-types/v10';
import initialPresence from '../utils/initial-presence';

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN environment variable not set.");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL environment variable not set.");
const token = process.env.DISCORD_TOKEN;


process.title = "Honeypot Bot (riskymh.dev) - Websocket Shard Worker";

process.on('uncaughtException', (err) => {
    console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

const getRedis = () => new Bun.RedisClient(process.env.REDIS_URL!)
const redis = getRedis();
const redisPubSub = getRedis();
const rest = new REST().setToken(token!);

const getShards = async () => (await rest.get(Routes.gatewayBot()) as RESTGetAPIGatewayBotResult).shards;
const getManager = (shards: number, sessionCache: Map<number, SessionInfo | null> = new Map()) => new WebSocketManager({
    token,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
    fetchGatewayInformation: () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
    compression: process.env.COMPRESS_WEBSOCKETS === "true" ? CompressionMethod.ZstdNative : null,
    shardCount: shards,
    initialPresence,
    retrieveSessionInfo: (shardId) => sessionCache.get(shardId) ?? null,
    updateSessionInfo: (shardId, sessionInfo) => void sessionCache.set(shardId, sessionInfo ?? null)
});
const managerState = "a" // update this when initial presense or intents changes (ie require shards to reconnect)

const sessionInfoCache: Record<number, Map<number, SessionInfo | null>> = {};
async function getSessionStorageFromRedis(_shardCount = 1) {
    const _raw = await redis.hmget("discord_ws_sessions", managerState, `${managerState}_${_shardCount}`, `Z_${managerState}_${_shardCount}`, _shardCount.toString());
    const raw = _raw[0] || _raw[1] || _raw[2] || _raw[3];
    if (raw) {
        const data = JSON.parse(raw) as Record<string, SessionInfo | null>;
        return new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v]));
    }
    return null;
}
async function saveSessionStorageToRedis(sessionStorage: Map<number, SessionInfo | null>) {
    const obj = Object.fromEntries(sessionStorage);
    const threeMinSecs = 3 * 60;
    await redis.hsetex("discord_ws_sessions", "EX", threeMinSecs, "FIELDS", 1, managerState, JSON.stringify(obj));
}

const prevSessionStorage = (await getSessionStorageFromRedis() || await getSessionStorageFromRedis(await getShards())) ?? new Map();
sessionInfoCache[prevSessionStorage.size] = prevSessionStorage;
let shardCount = prevSessionStorage.size || (await getShards());
let manager = getManager(shardCount, sessionInfoCache[shardCount]);
let isResharding = null as null | [WebSocketManager, number /* shard count */];
let reshardedId = 0;

const onExit = async (type: string) => {
    console.log(`Received ${type}, shutting down...`);
    const possibleSessionCache = sessionInfoCache[shardCount];
    if (possibleSessionCache) {
        try {
            for (let i = 0; i < shardCount; i++) {
                if (!possibleSessionCache.has(i)) possibleSessionCache.set(i, null);
            }
            await saveSessionStorageToRedis(possibleSessionCache);
        } catch (err) {
            console.error(`Error saving session storage to Redis on shutdown: ${err}`);
        }
    }
    process.exit(0);
}
process.on('SIGTERM', onExit.bind(null, "SIGTERM"));
process.on('SIGINT', onExit.bind(null, "SIGINT"));

const dispatchEvent = async (id: number, event: GatewayDispatchPayload, shardId: number) => {
    if (event.t === GatewayDispatchEvents.Ready) {
        console.info(`[Shard ${shardId}] ${event.d.user.username}#${event.d.user.discriminator} is ready!`);
    }

    // only send events from one ws manager - checking manually is safer than assuming listener is 100% destroyed
    if (reshardedId !== id) return;

    if (await shouldBroadcastEvent(event)) {
        // interactions are more important that we respond on time
        if (event.t === GatewayDispatchEvents.InteractionCreate) {
            redis.lpush("discord_events", JSON.stringify(event));
        } else {
            redis.rpush("discord_events", JSON.stringify(event));
        }
    }
}

const shardError = (error: Error, shardId: number) => console.error(`[Shard ${shardId}] Error:`, error);
const shardDebug = (message: string, shardId: number) => console.debug(`[Shard ${shardId}] Debug:`, message);
const shardResume = (shardId: number) => console.log(`[Shard ${shardId}] Resumed!`);

manager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent.bind(null, reshardedId));
manager.addListener(WebSocketShardEvents.Error, shardError);
if (process.env.NODE_ENV === "development") manager.addListener(WebSocketShardEvents.Debug, shardDebug);
manager.addListener(WebSocketShardEvents.Resumed, shardResume);

let wsConfig = {} as { events?: Set<string>, messageEvents?: { sendBotEvents?: boolean } };
redisPubSub.subscribe("discord_ws_config", async (message) => {
    const _wsConfig = JSON.parse(message);
    wsConfig = {
        events: new Set(_wsConfig.events),
        messageEvents: _wsConfig.messageEvents,
    };
});
redis.get("discord_ws_config").then((raw) => {
    if (!raw) return;
    const _wsConfig = JSON.parse(raw)
    wsConfig = {
        events: new Set(_wsConfig.events),
        messageEvents: _wsConfig.messageEvents,
    };
})


function shouldBroadcastEvent(event: GatewayDispatchPayload): boolean | Promise<boolean> {
    if (!wsConfig.events) return true;
    if (!wsConfig.events.has(event.t)) return false;
    // Even though we actually check subscribed channels, we should still filter out "high traffic" message events as early as possible
    if (wsConfig.messageEvents?.sendBotEvents === false) {
        // deletes dont contain any info other than ids, so we can allow them to go through even for bot messages without worrying about extra bot events getting through
        // at least bot msg deletes aren't as common and also we need it to know if someone removed out honeypot warning msg anyway
        if (event.t === GatewayDispatchEvents.MessageCreate || event.t === GatewayDispatchEvents.MessageUpdate) {
            // bot messages are somewhat often from logging so we limit it, but if it was slash command type we want as we associate the msg with the user who ran
            if (event.d?.author?.bot && !event.d?.interaction_metadata) return false;
        }
        // else if ((event.t === GatewayDispatchEvents.TypingStart) && event.d?.member?.user?.bot) return false;
    }
    if (
        (event.t === GatewayDispatchEvents.MessageCreate || event.t === GatewayDispatchEvents.MessageUpdate || event.t === GatewayDispatchEvents.MessageDelete || event.t === GatewayDispatchEvents.MessageDeleteBulk)
        && typeof event.d.guild_id === "string"
    ) {
        const guildId = event.d.guild_id;
        const channelId = event.d.channel_id;
        return redis.hget("discord_ws_config:guild-channels", guildId).then((channels) => {
            if (!channels) return true;
            const channelIds = channels.split(",");
            return channelIds.includes(channelId);
        });
    };
    return true;
}

// every day recheck if shard count has increased, if so make them run both at same time for a bit to hopefully avoid downtime, then kill old one
const checkForResharding = async (force = false) => {
    try {
        const newShardCount = (await getShards());
        if (newShardCount > shardCount || force) {
            console.info(`\nShard count increased from ${shardCount} to ${newShardCount}, resharding...`);

            if (isResharding) {
                if (isResharding[1] === newShardCount) {
                    console.warn(`Already resharding to ${isResharding[1]} shards, will wait for that to complete instead...`);
                    return;
                } else {
                    console.warn(`Already resharding to ${isResharding[1]} shards, but now need to reshard to ${newShardCount} shards. Restarting the resharding process with the new shard count...`);
                    isResharding[0].destroy();
                }
            }

            let shardsConnected = new Set<number>();
            const newManager = getManager(newShardCount, (sessionInfoCache[newShardCount] ??= new Map()));
            isResharding = [newManager, newShardCount];
            function dispatchEvent2(event: GatewayDispatchPayload, shardId: number) {
                if (event.t === GatewayDispatchEvents.Ready) {
                    console.info(`[Shard ${shardId}] ${event.d.user.username}#${event.d.user.discriminator} is ready! (resharded)`);
                    shardsConnected.add(shardId);
                }
            }
            newManager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent2);
            newManager.addListener(WebSocketShardEvents.Error, shardError);
            if (process.env.NODE_ENV === "development") newManager.addListener(WebSocketShardEvents.Debug, shardDebug);
            newManager.addListener(WebSocketShardEvents.Resumed, shardResume);
            try {
                await newManager.connect();
            } catch (err) {
                console.error(`Error connecting new WebSocket Manager during resharding: ${err}`);
                newManager.destroy();
                isResharding = null;
                return;
            }

            // wait for all new shards to be ready, then kill old manager
            while (shardsConnected.size !== newShardCount) {
                await Bun.sleep(1000);
            }

            // wait a bit more to ensure that they are all are properly ready,
            // and not still sending GUILD_CREATE spam and thus not actually sending the real events on time
            await Bun.sleep(60_000);

            console.info(`All ${newShardCount} shards connected, transfering over managers...`);
            const newReshardedId = reshardedId + 1;
            newManager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent.bind(null, newReshardedId));
            newManager.removeListener(WebSocketShardEvents.Dispatch, dispatchEvent2);
            reshardedId = newReshardedId;
            manager.removeAllListeners(WebSocketShardEvents.Dispatch);
            manager.destroy();
            manager = newManager;
            sessionInfoCache[shardCount]?.clear();
            delete sessionInfoCache[shardCount];
            shardCount = newShardCount;
            isResharding = null;
        }
    } catch (err) {
        console.error(`Error checking shard count: ${err}`);
    }
};

console.log(`Starting WebSocket Manager with ${shardCount} shards...`);
if (sessionInfoCache[shardCount]?.size) {
    console.log("Found existing session info in Redis, attempting to resume sessions...");
}
try {
    await manager.connect();
} catch (err) {
    console.error(`Error connecting WebSocket Manager: ${err}`);
    await redis.del("discord_ws_sessions").catch((err) => {
        console.error(`Error clearing session storage in Redis after failed connection attempt: ${err}`);
    });
    process.exit(1);
}

if (sessionInfoCache[shardCount]?.size) checkForResharding();

setInterval(checkForResharding, 12 * 60 * 60 * 1000); // twice every day
