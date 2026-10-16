import type { Cron } from "./crons";

// this file should be deleted (or disabled) in next commit
const cron: Cron = {
    name: "Generate webhooks (one off)",
    frequency: "once",
    run: async (api, db, redis) => {
        if (await db.getWebhookCount() > 0) {
            console.log("Webhooks already exist, skipping generation.");
            return;
        }

        // generate webhooks for all guilds that have the channel-warmer experiment enabled
        const guilds = await db.getGuildsWithExperiment("channel-warmer");
        if (guilds.length === 0) {
            console.log("No guilds with channel-warmer experiment enabled, skipping generation.");
            return;
        }

        const avatar = await fetch("https://honeypot.riskymh.dev/honeypot.png").then(r => r.arrayBuffer()).catch(() => null);
        const avatarStr = avatar ? `data:image/png;base64,${Buffer.from(avatar).toString("base64")}` : null;
        const errors: Record<string, number> = {};
        let webhooksMade = 0;
        for (const guild of guilds) {
            const guildId = guild.guild_id;
            const channels = await db.getChannels(guildId);
            for (const { channel_id: channelId } of channels) {
                try {
                    const webhook = await api.channels.createWebhook(channelId, { name: "Honeypot", avatar: avatarStr }, { reason: "Generating webhook for channel-warmer experiment" });
                    await db.setWebhook(guildId, channelId, webhook.id, webhook.token!, []);
                    webhooksMade++;
                } catch (err) {
                    const errStr = `${err}`;
                    errors[errStr] = (errors[errStr] || 0) + 1;
                }
                await Bun.sleep(1000); // self-imposed rate limit
            }
        }

        if (Object.keys(errors).length > 0) {
            console.log(`[generate-webhooks migration] Failed to generate webhook:\n- ${Object.entries(errors).map(([err, count]) => `${err} (${count})`).join("\n- ")}`);
        }
        console.log(`[generate-webhooks migration] Generated ${webhooksMade} webhooks for ${guilds.length} guilds.`);
    },
};

export default cron;
