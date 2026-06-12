import { ButtonStyle, ChannelType, GatewayDispatchEvents, MessageFlags, ComponentType, type GatewayGuildCreateDispatchData, type APIRole, PermissionFlagsBits, RESTJSONErrorCodes, GuildFeature } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { honeypotWarningMessage } from "../utils/messages";
import { addToDeleteMessageCache, getCommandIdCache, removeFromDeleteMessageCache, setGuildInfoCache, setSubscribedChannelCache } from "../utils/cache";
import randomChannelNames from "../utils/random-channel-names.yaml";
import { getRoleMemberCounts } from "../utils/discord-api";
import { DiscordAPIError } from "@discordjs/rest";
import lookalikeChars from "../utils/lookalike-chars.yaml";

const handler: EventHandler<GatewayDispatchEvents.GuildCreate> = {
    event: GatewayDispatchEvents.GuildCreate,
    handler: async ({ data: guild, api, applicationId, redis, db }) => {
        // if the guild is unavailable, we can’t do anything, so just skip it. We’ll get another event when it becomes available again
        if (guild.unavailable) return;

        try {
            setGuildInfoCache(guild.id, { name: guild.name, ownerId: guild.owner_id, isDiscoverable: guild.features.includes(GuildFeature.Discoverable) }, redis);

            // if we already have config for this server, don't try to recreate (every bot resart creates this event) 
            let config = await db.getConfig(guild.id);
            if (config) return;

            let channelId = null as null | string;
            let msgId = null as null | string;
            let setupSuccess = false;
            try {
                const { id: channId, new: isNewChannel } = await findOrCreateHoneypotChannel(api, guild);
                channelId = channId;
                msgId = await postWarning(api, channelId, applicationId, "softban", 0);
                setupSuccess = true;
                if (isNewChannel) {
                    sendIntroMessage(api, redis, channelId)
                        .catch((err) => console.log(`Failed to send intro message: ${err}`))
                        .then((introMsgId) => introMsgId &&
                            checkSetupAndWarn(api, channelId!, applicationId, redis, guild)
                        ).catch((err) => console.log(`Failed to check setup and send warning msg: ${err}`))
                } else {
                    checkSetupAndWarn(api, channelId, applicationId, redis, guild)
                        .catch((err) => console.log(`Failed to check setup and send warning msg: ${err}`))
                }
            } catch (err) {
                if (err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.UnknownChannel)) {
                    channelId = null;
                    msgId = null;
                    setupSuccess = false;
                }
                console.log(`Failed to create/send honeypot message: ${err}`);
            }
            await db.setConfig({
                guild_id: guild.id,
                log_channel_id: null,
                action: 'softban',
                experiments: [],
            });
            if (channelId) {
                await db.setHoneypotChannels(guild.id, [{ channel_id: channelId, msg_id: msgId }]);
                if (redis) setSubscribedChannelCache(guild.id, [channelId], redis);
            }
            redis?.publish("guild_count", "+1");
            if (!setupSuccess && guild.system_channel_id) {
                try {
                    await api.channels.createMessage(guild.system_channel_id, {
                        content: `👋 Thanks for adding the honeypot bot! Please run /honeypot to finish setup.\n-# The bot couldn’t create or send the warning message automatically.`,
                        allowed_mentions: {}
                    });
                } catch (err) {
                    console.log(`Failed to send welcome/setup message: ${err}`);
                }
            }
        } catch (err) {
            console.log(`Error with GuildCreate handler: ${err}`);
        }
    }
};

async function findOrCreateHoneypotChannel(api: API | API2, guild: GatewayGuildCreateDispatchData): Promise<{ id: string, new?: true | undefined }> {
    const channel = guild.channels.find((c) => normalizeText(c.name) === "honeypot" && c.type === ChannelType.GuildText);
    if (channel) return { id: channel.id };

    const newChannel = await api.guilds.createChannel(guild.id, {
        name: `h${obfuscateText("oneypot", 0.3)}`,
        type: ChannelType.GuildText,
        position: guild.channels.length + 1,
    }, {
        reason: "Honeypot channel for bot",
    });
    return { id: newChannel.id, new: true };
}


async function postWarning(api: API | API2, channelId: string, applicationId: string, action = "softban" as const, moderatedCount = 0) {
    const messages = await api.channels.getMessages(channelId, { limit: 100 }).catch(() => []);
    const botMessages = messages.filter(m => m.author?.id === applicationId).reverse();

    if (botMessages.length > 0) {
        const first = botMessages.find(m => !m.referenced_message || !m.interaction_metadata);
        const rest = first ? botMessages.filter(m => m.id !== first.id) : botMessages;

        if (!first) {
            const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
            return msg.id;
        }
        try {
            await api.channels.editMessage(channelId, first.id, honeypotWarningMessage(moderatedCount, action));
            await Promise.allSettled(rest.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
            return first.id;
        } catch (err) {
            const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
            await Promise.allSettled(botMessages.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
            return msg.id;
        }
    } else {
        const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
        return msg.id;
    }
}

async function sendIntroMessage(api: API | API2, redis: Bun.RedisClient | undefined, channelId: string) {
    const commands = redis ? await getCommandIdCache(redis) : null;
    function getCommandMention(commandName: string) {
        const commandId = commands?.[commandName];
        if (!commandId) return `\`/${commandName}\``;
        return `</${commandName}:${commandId}>`;
    }

    const removalTime = 2.5 * 60 * 1000;
    const inDiscordTimeString = `<t:${Math.floor((Date.now() + removalTime) / 1000)}:R>`;

    const randomNames = Array.isArray(randomChannelNames) ? randomChannelNames : ["dont-type-here"]
    const newName = randomNames[Math.floor(Math.random() * randomNames.length)];

    const { id: msgId } = await api.channels.createMessage(channelId, {
        flags: MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.TextDisplay,
                content: `
## 👋 Welcome to the honeypot channel! 
- By default, any user that sends a message in this channel will be **automatically softbanned** (banned and instantly unbanned to delete last 1hr messages)
- You can customise this and more with the ${getCommandMention("honeypot")} command and the custom messages it sends with ${getCommandMention("honeypot-messages")}!
- **Tips for maximum effectiveness:**
  - Rename this channel to something unique (e.g., \`${newName}\`) so bots can’t easily guess and blacklist it, but keep it clear for real members
  - Keep it near the top of your channel list - bots often target the first few channels
  - Make sure the bot’s highest role is set above any self-assignable roles, so it can act on all users
- If you have feedback or notice bots bypassing the honeypot, join our [support server](https://discord.gg/BanFeVWyFP) or checkout out the [docs](https://honeypot.riskymh.dev/docs) and the open source [github repo](https://github.com/riskymh/honeypot)!
`.trim()
            },
            {
                type: ComponentType.Section,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: `-# This message will delete ${inDiscordTimeString}`
                    }
                ],
                accessory: {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: "Delete message now",
                    custom_id: "delete_intro_message",
                }
            },
        ]
    });
    if (redis) await addToDeleteMessageCache(channelId, msgId, redis);
    setTimeout(async () => {
        await api.channels.deleteMessage(channelId, msgId, { reason: "Cleaning up welcome message" }).catch(() => { });
        if (redis) await removeFromDeleteMessageCache(channelId, msgId, redis);
    }, removalTime);
    return msgId;
}


async function checkSetupAndWarn(api: API | API2, channelId: string, applicationId: string, redis: Bun.RedisClient | undefined, guild: GatewayGuildCreateDispatchData) {
    // check if any role has more than 65% of the members, because otherwise only few can be banned
    const roleCounts = await getRoleMemberCounts(api, guild.id, { signal: AbortSignal.timeout(10_000) }).catch(() => ([]));
    const memberCount = guild.member_count;
    const anyRoleHasMostMembers = guild.member_count > 50 ? Object.values(roleCounts).some(count => count >= memberCount * 0.65) : false;

    // also check if they even invited the bot with correct permissions, because if not then it can’t ban anyone
    const thisBot = guild.members.find(m => m.user.id === applicationId);
    const botPermissions = thisBot ? getPermissionsForMember(guild.roles, thisBot.roles) : BigInt(PermissionFlagsBits.Administrator);
    const canBan = hasPermission(botPermissions, PermissionFlagsBits.BanMembers);

    // also check if this channel can be seen by everyone (ie view channel permission for @everyone role), because if not then it defeats the purpose of honeypot
    // since we just made the channel, we know there cant be any overides, so we can just check the everyone role permissions
    const everyoneRole = guild.roles.find(r => r.id === guild.id);
    const canEveryoneViewChannel = everyoneRole?.permissions ? hasPermission(BigInt(everyoneRole?.permissions), PermissionFlagsBits.ViewChannel) : true;

    if (anyRoleHasMostMembers || !canBan || !canEveryoneViewChannel) {
        let content = "";
        if (anyRoleHasMostMembers) content += "\n- There is a role that’s higher than the bot’s with >65% of the members";
        if (!canBan) content += "\n- The bot doesn’t have permission to ban members, which means it can’t softban anyone";
        if (!canEveryoneViewChannel) content += "\n- The @everyone role can’t view the honeypot channel, which means most members can’t send any messages here";

        const msg = await api.channels.createMessage(channelId!, {
            components: [
                {
                    type: ComponentType.Container,
                    accent_color: 0xFFA500,
                    components: [
                        {
                            type: ComponentType.Section,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: "### \\⚠️ Some potential problems were detected:",
                                },
                            ],
                            accessory: {
                                type: ComponentType.Button,
                                style: ButtonStyle.Secondary,
                                label: "Dismiss",
                                custom_id: "delete_intro_message",
                            }
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content,
                        },
                    ],
                },
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowed_mentions: {},
        });

        if (redis) await addToDeleteMessageCache(channelId, msg.id, redis);
    }
}

function getPermissionsForMember(roles: APIRole[], memberRoles: string[]) {
    let permissions = BigInt(0);
    for (const role of roles) {
        if (memberRoles.includes(role.id)) {
            permissions |= BigInt(role.permissions);
        }
    }
    return permissions;
}

function hasPermission(permissions: bigint, permissionBit: bigint) {
    return (permissions & permissionBit) === permissionBit || (permissions & PermissionFlagsBits.Administrator) === permissionBit;
}

const lookalikesData = lookalikeChars as Record<string, string[] | string>;
const reverseLookalikeData: Record<string, string> = {};
for (const [canonicalChar, value] of Object.entries(lookalikesData)) {
    if (Array.isArray(value)) {
        for (const variant of value) reverseLookalikeData[variant] = canonicalChar;
    } else if (typeof value === "string") {
        reverseLookalikeData[value] = canonicalChar;
    }
};

export function obfuscateText(str: string, chance: number = 0.3): string {
    let result = '';
    for (const char of str) {
        const variants = lookalikesData[char];
        if (variants && variants.length > 0 && Math.random() < chance) {
            const randomIndex = variants.length === 1 ? 0 : Math.floor(Math.random() * variants.length);
            result += variants[randomIndex];
        } else {
            result += char;
        }
    }
    return result;
}

export function normalizeText(str: string): string {
    let result = '';
    for (const char of str) {
        result += reverseLookalikeData[char] || char;
    }
    return result;
}

export default handler;