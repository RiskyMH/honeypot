
import { getFullStats, initDb } from "../utils/db";

await initDb();

const redisPubSub = new Bun.RedisClient(process.env.REDIS_URL!);

let cacheResult = null as null | Awaited<ReturnType<typeof getFullStats>>;
let cacheTimestamp = 0;
const cacheDuration = 30 * 1000; // 30 seconds

async function getStats() {
    const now = Date.now();
    if (cacheResult && (now - cacheTimestamp < cacheDuration)) {
        return cacheResult;
    }
    console.time("getStats");
    const result = await getFullStats();
    console.timeEnd("getStats");
    cacheResult = result;
    cacheTimestamp = now;
    return result;
}

const server = Bun.serve({
    port: parseInt(process.env.PORT || "3000"),
    routes: {
        "/": {
            GET: async () => {
                const stats = await getStats();
                return new Response(JSON.stringify(stats), {
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=15, stale-while-revalidate=600",
                    }
                });
            }
        },
        "/stats": {
            GET: async () => {
                const stats = await getStats();
                return new Response(JSON.stringify(stats), {
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=15, stale-while-revalidate=600",
                    }
                });
            }
        },
        "/ws": {
            GET: (req, server) => {
                if (server.upgrade(req)) return
                return new Response("Upgrade failed", { status: 500 });
            },
        },
        "/live": {
            GET: new Response(`
                <html>
                    <head>
                        <title>Honeypot Stats</title>
                        <meta name="color-scheme" content="light dark">
                    </head>
                    <body>
                        <h1>Honeypot Stats</h1>
                        <pre id="stats">Loading...</pre>
                        <script>
                            const statsEl = document.getElementById("stats");
                            const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
                            ws.onmessage = (event) => {
                                const data = JSON.parse(event.data);
                                statsEl.textContent = JSON.stringify(data, null, 2);
                            };
                            ws.onclose = () => {
                                statsEl.textContent = "Connection lost, reconnecting...";
                                setTimeout(() => {
                                    location.reload();
                                }, 1000);
                            };
                        </script>
                    </body>
                </html>
                `, {
                headers: {
                    "Content-Type": "text/html"
                },
            })
        },
    },

    websocket: {
        maxPayloadLength: 1,
        backpressureLimit: 1,
        closeOnBackpressureLimit: true,
        idleTimeout: 600,
        sendPings: true,
        open: async (ws) => {
            ws.subscribe("stats_update")
            const stats = await getStats();
            ws.sendText(JSON.stringify(stats))
        },
        close: (ws) => void ws.unsubscribe("stats_update"),
        message: () => { },
        drain: () => { },
    },
})

let pendingStatsUpdate = false;
let statsUpdateTimer: NodeJS.Timeout | null = null;

function scheduleNextPublish() {
    if (statsUpdateTimer) return;
    const now = new Date();
    const seconds = now.getUTCSeconds();
    const millis = now.getUTCMilliseconds();
    const nextInterval = 5 - (seconds % 5);
    const msUntilNext = (nextInterval * 1000) - millis;
    statsUpdateTimer = setTimeout(async () => {
        if (pendingStatsUpdate) {
            console.time("getStats for publish");
            const stats = await getFullStats();
            console.timeEnd("getStats for publish");
            cacheResult = stats;
            cacheTimestamp = Date.now();
            server.publish("stats_update", JSON.stringify(stats));
            pendingStatsUpdate = false;
        }
        statsUpdateTimer = null;
        scheduleNextPublish();
    }, msUntilNext);
}

redisPubSub.subscribe(["guild_count", "moderate_event"], async (message) => {
    if (server.subscriberCount("stats_update") === 0) {
        cacheResult = null;
        cacheTimestamp = 0;
        pendingStatsUpdate = false;
        return;
    }
    pendingStatsUpdate = true;
    scheduleNextPublish();
});


console.log(`Stats API server started on ${server.url}`);


// const redis = new Bun.RedisClient(process.env.REDIS_URL!);
// setInterval(async () => {
//     redis.publish("guild_count", "");
// }, 1000);
