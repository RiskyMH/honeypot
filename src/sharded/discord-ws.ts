import { WebSocketManager, WebSocketShardEvents, CompressionMethod } from '@discordjs/ws';
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

const redis = Bun.redis;
const rest = new REST().setToken(token!);

const getShards = async () => (await rest.get(Routes.gatewayBot()) as RESTGetAPIGatewayBotResult).shards;
const getManager = (shards: number | null = null) => new WebSocketManager({
    token: token,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
    rest,
    compression: CompressionMethod.ZlibNative,
    shardCount: shards,
    initialPresence: initialPresence,
});
let shardCount = await getShards();
let manager = getManager(shardCount);
let isResharding = null as null | [WebSocketManager, number /* shard count */];

const dispatchEvent = async (event: GatewayDispatchPayload, shardId: number, shardsConnected?: number[]) => {
    if (event.t === GatewayDispatchEvents.Ready) {
        console.info(`[Shard ${shardId}] ${event.d.user.username}#${event.d.user.discriminator} is ready!`);
        shardsConnected?.push(shardId);
    }

    // dont send duplicate events during resharding,
    // but in normal operation, no need to waste io hashing events, just send them all
    if (isResharding) {
        const hash = `${event.t}:${Bun.hash(JSON.stringify(event.d))}`;
        if (await Bun.redis.exists(hash)) {
            return false;
        }
        /* doesnt need await */ Bun.redis.setex(hash, 60, "1");
    }

    const shouldbroadcast = shouldBroadcastEvent(event)
    if (shouldbroadcast) {
        await redis.lpush("discord_events", JSON.stringify(event));
    }
}

manager.on(WebSocketShardEvents.Dispatch, dispatchEvent);

let wsConfig = {} as { events?: string[], messageEvents?: { sendBotEvents?: boolean } };
(async () => {
    const raw = await redis.get("discord_ws_config")
    if (raw) wsConfig = JSON.parse(raw)

    while (1) {
        const raw = await redis.blpop("discord_ws_status_", 0)
        if (raw) wsConfig = JSON.parse(raw[1])
    }
})();


function shouldBroadcastEvent(event: GatewayDispatchPayload): boolean {
    if (!wsConfig.events) return true;
    if (!wsConfig.events.includes(event.t)) return false;
    if (wsConfig.messageEvents?.sendBotEvents === false) {
        // deletes dont contain any info other than ids, so we can allow them to go through even for bot messages without worrying about extra bot events getting through
        // at least bot msg deletes aren't as common, and also we need it to know if someone removed out honeypot warning msg anyway
        if ((event.t === GatewayDispatchEvents.MessageCreate || event.t === GatewayDispatchEvents.MessageUpdate) && event.d?.author?.bot) return false;
        if ((event.t === GatewayDispatchEvents.TypingStart) && event.d?.member?.user?.bot) return false;
    }
    return true;
}


// every day recheck if shard count has increased, if so make them run both at same time for a bit to hopefully avoid downtime, then kill old one
const checkForResharding = async () => {
    try {
        const newShardCount = (await getShards());
        if (newShardCount > shardCount) {
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

            let shardsConnected = [] as number[];
            const newManager = getManager(newShardCount);
            isResharding = [newManager, newShardCount];
            newManager.on(WebSocketShardEvents.Dispatch, (event, shardId) => dispatchEvent(event, shardId, shardsConnected));
            await newManager.connect();

            // wait for all new shards to be ready, then kill old manager
            const checkInterval = setInterval(() => {
                if (shardsConnected.length === newShardCount) {
                    console.info(`All ${newShardCount} shards connected, killing old manager...`);
                    manager.removeAllListeners(WebSocketShardEvents.Dispatch);
                    manager.destroy();
                    manager = newManager;
                    shardCount = newShardCount;
                    clearInterval(checkInterval);
                    process.nextTick(() => isResharding = null);
                }
            }, 1000);
        }
    } catch (err) {
        console.error(`Error checking shard count: ${err}`);
    }
};

console.log(`Starting WebSocket Manager with ${shardCount} shards...`);
await manager.connect();


setInterval(checkForResharding, 24 * 60 * 60 * 1000); // every day


