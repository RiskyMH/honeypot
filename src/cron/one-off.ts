import { getDeleteMessageCache, removeFromDeleteMessageCache } from "../utils/cache";
import type { Cron } from "./crons";


const cron: Cron = {
    name: "One-off message removal",
    frequency: "once",
    run: async (api, db, redis) => {
        if (redis) {
            const messagesToDelete = await getDeleteMessageCache(redis);
            if (messagesToDelete.length === 0) return;
            await Bun.sleep(2 * 60 * 1000); // 2m
            for (const msg of messagesToDelete) {
                if (!msg.channelId || !msg.messageId) continue;
                await api.channels.deleteMessage(msg.channelId, msg.messageId, { reason: "Removing one-off message" }).catch(() => { });
                await removeFromDeleteMessageCache(msg.channelId, msg.messageId, redis);
            }
        }
    },
};

export default cron;
