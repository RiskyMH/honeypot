import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { failedToTimeoutMembers, notHoneypottedChannelIds, typingNotEnabledGuilds } from "../utils/cache";
import { getConfig } from "../utils/db";

const handler: EventHandler<GatewayDispatchEvents.TypingStart> = {
    event: GatewayDispatchEvents.TypingStart,
    handler: async ({ data: message, api, applicationId }) => {
        if (!message.guild_id || message.member?.user.bot) return;
        if (failedToTimeoutMembers.includes(`${message.guild_id}-${message.user_id}`)) return;
        if (notHoneypottedChannelIds.includes(message.channel_id)) return;
        if (typingNotEnabledGuilds.includes(message.guild_id)) return;

        const config = await getConfig(message.guild_id);
        if (!config || !config.experiments.includes("timeout-for-typing")) {
            typingNotEnabledGuilds.push(message.guild_id);
            if (typingNotEnabledGuilds.length > 100) {
                typingNotEnabledGuilds.shift();
            }
            return;
        };
        if (message.channel_id !== config.honeypot_channel_id) {
            notHoneypottedChannelIds.push(message.channel_id);
            if (notHoneypottedChannelIds.length > 100) {
                notHoneypottedChannelIds.shift();
            }
            return;
        };

        try {
            await api.guilds.editMember(message.guild_id, message.user_id, {
                communication_disabled_until: new Date(Date.now() + 10_000).toISOString(),
            }, {
                reason: "User is typing in the honeypot channel (timeout-for-typing experiment)",
                signal: AbortSignal.timeout(1_500),
            });
        } catch (err) {
            console.log(`Failed to timeout user for typing in honeypot channel: ${err}`);
            if (err instanceof Error && !["AbortError", "TimeoutError"].includes(err.name)) {
                failedToTimeoutMembers.push(`${message.guild_id}-${message.user_id}`);
                if (failedToTimeoutMembers.length > 100) {
                    failedToTimeoutMembers.shift();
                }
            }
        }
    }
};

export default handler;
