import { ButtonStyle, ChannelType, ComponentType, GatewayDispatchEvents, InteractionType, MessageFlags, PermissionFlagsBits, SelectMenuDefaultValueType, TextInputStyle, type APIModalInteractionResponseCallbackData, type RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { getConfig, type HoneypotConfig, getModeratedCount, getHoneypotMessages, setConfig, setHoneypotMessages, getStats, getUserModeratedCount } from "../utils/db";
import { honeypotWarningMessage, defaultHoneypotWarningMessage, defaultHoneypotUserDMMessage, defaultLogActionMessage, honeypotUserDMMessage } from "../utils/messages";
import { channelWarmerExperiment, randomChannelNameExperiment } from "../cron/experiments";
import getBadWords from "../utils/bad-words.macro" with { type: "macro" };
import { CUSTOM_EMOJI, CUSTOM_EMOJI_ID } from "../utils/constants";
import { getGuildInfo } from "../utils/cache";

const hasPermission = (permissions: bigint, permission: bigint) => (permissions & permission) === permission;

const badWords = getBadWords() as any as string[];
const containsBadWord = (text: string): string | null => {
    const inputWords = text.toLowerCase().replace(/[^a-z0-9]/gi, ' ').split(/\W+/).filter(Boolean);
    return inputWords.find(word => badWords.includes(word)) || null;
}


const handler: EventHandler<GatewayDispatchEvents.InteractionCreate> = {
    event: GatewayDispatchEvents.InteractionCreate,
    handler: async ({ data: interaction, api, applicationId }) => {
        const guildId = interaction.guild_id;

        try {
            // slash command handler: show modal
            if (guildId && interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot") {
                let config = await getConfig(guildId);
                config ||= {
                    guild_id: guildId,
                    honeypot_channel_id: null,
                    honeypot_msg_id: null,
                    log_channel_id: null,
                    action: 'softban',
                    experiments: []
                };

                const modal: APIModalInteractionResponseCallbackData = {
                    title: "Honeypot",
                    custom_id: `honeypot_config_modal`,
                    components: [
                        {
                            type: ComponentType.Label,
                            label: "Honeypot Channel",
                            description: "Any message sent in this channel will cause the author to be kicked/banned from server",
                            component: {
                                type: ComponentType.ChannelSelect,
                                custom_id: "honeypot_channel",
                                min_values: 1,
                                max_values: 1,
                                placeholder: "#honeypot",
                                channel_types: [ChannelType.GuildText],
                                default_values: config.honeypot_channel_id ? [{ id: config.honeypot_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
                                required: true,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Log Channel",
                            description: "The channel to log events (ie kicks/bans that the bot actioned)",
                            component: {
                                type: ComponentType.ChannelSelect,
                                custom_id: "log_channel",
                                min_values: 0,
                                max_values: 1,
                                placeholder: "#mod-log",
                                channel_types: [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread],
                                default_values: config.log_channel_id ? [{ id: config.log_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
                                required: false,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Action",
                            description: "What should the bot do to message author?",
                            component: {
                                type: ComponentType.RadioGroup,
                                custom_id: "honeypot_action",
                                options: [
                                    { label: "Softban (kick)", value: "softban", description: "Bans & unbans to delete last 1hr of messages", default: config.action === "softban" || (config.action as any) === "kick" || !config.action },
                                    { label: "Ban", value: "ban", description: "Permanently bans the user to also delete last 1hr of messages", default: config.action === "ban" },
                                    { label: "Disabled", value: "disabled", /*description: "Don’t do anything",*/ default: config.action === "disabled" }
                                ],
                                required: true,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Experiments",
                            // description: "Some optional experimental features to try out",
                            component: {
                                type: ComponentType.StringSelect,
                                custom_id: "honeypot_experiments",
                                placeholder: "Select experiments to enable",
                                options: [
                                    { label: "No Warning Msg", value: "no-warning-msg", description: "Don’t include a warning message in the #honeypot channel", default: config.experiments.includes("no-warning-msg") },
                                    { label: "No DM", value: "no-dm", description: "Don’t DM the user that they triggered the honeypot", default: config.experiments.includes("no-dm") },
                                    // { label: "Timeout for Typing", value: "timeout-for-typing", description: "Timeout users (for 10sec) who are typing in the honeypot channel", default: config.experiments.includes("timeout-for-typing") },
                                    { label: "Channel Warmer", value: "channel-warmer", description: "Keep the honeypot channel active (every day)", default: config.experiments.includes("channel-warmer") },
                                    { label: "Random Channel Name", value: "random-channel-name", description: "Randomize the honeypot channel name (every day)", default: config.experiments.includes("random-channel-name") },
                                    { label: "Random Channel Name (Chaos)", value: "random-channel-name-chaos", description: "Randomise the honeypot channel name with random characters (every day)", default: config.experiments.includes("random-channel-name-chaos") },
                                ],
                                max_values: 5,
                                required: false,
                            }
                        }
                    ]
                };
                await api.interactions.createModal(interaction.id, interaction.token, modal);
                return;
            }

            // modal submit handler: update config from modal values
            else if (guildId && interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_config_modal`) {
                const newConfig: HoneypotConfig = {
                    guild_id: guildId,
                    honeypot_channel_id: null,
                    honeypot_msg_id: null,
                    log_channel_id: null,
                    action: 'softban',
                    experiments: []
                }

                for (const label of interaction.data.components) {
                    if (label.type !== ComponentType.Label) continue;
                    const c = (label).component ?? label;
                    if (!c) continue;

                    if (c.type === ComponentType.ChannelSelect) {
                        if (c.custom_id === "honeypot_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.honeypot_channel_id = c.values[0]!;
                        if (c.custom_id === "log_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.log_channel_id = c.values[0]!;
                    }
                    if (c.type === ComponentType.RadioGroup) {
                        if (c.custom_id === "honeypot_action" && c.value) {
                            if (["kick", "ban", "disabled"].includes(c.value)) newConfig.action = c.value as any;
                        }
                    }
                    if (c.type === ComponentType.StringSelect) {
                        if (c.custom_id === "honeypot_experiments" && Array.isArray(c.values)) {
                            for (const val of c.values) {
                                if (["no-warning-msg", "no-dm", "random-channel-name", "random-channel-name-chaos", "channel-warmer"].includes(val)) {
                                    newConfig.experiments.push(val as any);
                                }
                            }
                        }
                    }
                }

                // shouldn’t happen, but just in case
                if (!newConfig.honeypot_channel_id) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "Honeypot channel is required! No changes have been made.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const prevConfig = await getConfig(guildId);
                const honeypotChanged = newConfig.honeypot_channel_id !== prevConfig?.honeypot_channel_id;
                const logChanged = newConfig.log_channel_id !== prevConfig?.log_channel_id;
                const actionChanged = newConfig.action !== prevConfig?.action;

                // pretty reasonable requests to ensure user can even do said actions
                {
                    const resolvedChannel = interaction.data.resolved?.channels?.[newConfig.honeypot_channel_id];
                    const requiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels;
                    if (honeypotChanged && !hasPermission(BigInt(resolvedChannel?.permissions || "0"), requiredPerms)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You don’t have enough permissions to set the honeypot channel to <#${newConfig.honeypot_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel, Manage Messages, Manage Channels.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    const resolvedLogChannel = newConfig.log_channel_id ? interaction.data.resolved?.channels?.[newConfig.log_channel_id] : null;
                    const logRequiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel;
                    if (logChanged && newConfig.log_channel_id && !hasPermission(BigInt(resolvedLogChannel?.permissions || "0"), logRequiredPerms)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You don’t have enough permissions to set the log channel to <#${newConfig.log_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    const memberPerms = interaction.member?.permissions
                    const banEvents = ["ban", "softban"];
                    // check ban permissions even if the action didn’t change, because any new channel moved to can suddenly ban people
                    if ((actionChanged || true) && banEvents.includes(newConfig.action) && memberPerms && !hasPermission(BigInt(memberPerms), PermissionFlagsBits.BanMembers)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You need the Ban Members permission to set the honeypot action to "${newConfig.action}".\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    const usingChannelNameExperiment = (newConfig.experiments.includes("random-channel-name") || newConfig.experiments.includes("random-channel-name-chaos"));
                    if (usingChannelNameExperiment && !hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.ManageChannels)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `I need the Manage Channels permission to enable the "Random Channel Name" experiment.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    // if any other actions added in future, add their equivalent permission checks here
                }

                // if honeypot channel changed or current honeypot msg is invalid, create new honeypot message
                // otherwise try to edit it with latest data
                // but if either fail, then let user know its broken sadly
                let msgId: string | null = null;
                if (!newConfig.experiments.includes("no-warning-msg")) {
                    try {
                        const count = await getModeratedCount(guildId);
                        const customMessages = await getHoneypotMessages(guildId);
                        const messageBody = honeypotWarningMessage(count, newConfig.action, customMessages?.warning_message);
                        if (honeypotChanged || !prevConfig?.honeypot_msg_id) {
                            const msg = await api.channels.createMessage(
                                newConfig.honeypot_channel_id,
                                messageBody
                            );
                            msgId = msg.id;
                        } else if (prevConfig?.honeypot_msg_id) {
                            try {
                                await api.channels.editMessage(
                                    newConfig.honeypot_channel_id,
                                    prevConfig.honeypot_msg_id,
                                    messageBody
                                );
                            } catch {
                                const msg = await api.channels.createMessage(
                                    newConfig.honeypot_channel_id,
                                    messageBody
                                );
                                msgId = msg.id;
                            }
                        } else {
                            console.log("No previous honeypot message ID found to edit.");
                        }
                    } catch (err) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `There was a problem setting up the honeypot channel to <#${newConfig.honeypot_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                } else if (prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
                    // they didn’t want honeypot msg, so delete old one if exists
                    await api.channels.deleteMessage(
                        prevConfig.honeypot_channel_id,
                        prevConfig.honeypot_msg_id,
                    ).catch(() => null);
                    newConfig.honeypot_msg_id = null;
                }

                if (logChanged && newConfig.log_channel_id) {
                    try {
                        await api.channels.createMessage(newConfig.log_channel_id, {
                            content: `Honeypot is set up in <#${newConfig.honeypot_channel_id}>! This current channel will log honeypot events.`,
                            allowed_mentions: {},
                        });
                    } catch {
                        // clean up just created honeypot message if log channel fails (because user might think it's fully set up otherwise)
                        if (msgId) {
                            await api.channels.deleteMessage(newConfig.honeypot_channel_id, msgId, { reason: "Cleaning up honeypot message after log channel setup failure" }).catch(() => null);
                        }

                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `There was a problem sending test message to the log channel <#${newConfig.log_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
                            flags: MessageFlags.Ephemeral,
                            allowed_mentions: {},
                        });
                        return;
                    }
                }

                await setConfig({
                    ...(prevConfig || {}),
                    ...newConfig,
                    honeypot_msg_id: (newConfig.experiments.includes("no-warning-msg") && !newConfig.honeypot_msg_id)
                        ? null
                        : (msgId || newConfig.honeypot_msg_id || prevConfig?.honeypot_msg_id || null),
                });
                await api.interactions.reply(interaction.id, interaction.token, {
                    content: `Honeypot config updated!\n-# - Channel: <#${newConfig.honeypot_channel_id}>\n-# - Log Channel: ${newConfig.log_channel_id ? `<#${newConfig.log_channel_id}>` : '*(Not set)*'}\n-# - Action: **${newConfig.action}**${newConfig.experiments.length > 0 ? `\n-# - Experiments: ${newConfig.experiments.map(e => `\`${e}\``).join(", ")}` : ''}`,
                    allowed_mentions: {},
                });

                if (msgId && prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
                    await api.channels.deleteMessage(
                        prevConfig.honeypot_channel_id,
                        prevConfig.honeypot_msg_id,
                        { reason: "Honeypot channel changed, so cleaning up old honeypot message" }
                    ).catch(() => null);
                }

                // run any experiments that were just enabled immediately to show user it works
                if (!prevConfig?.experiments.includes("channel-warmer") && newConfig.experiments.includes("channel-warmer")) {
                    try {
                        await channelWarmerExperiment(api, guildId, newConfig.honeypot_channel_id!)
                    } catch (err) {
                        await api.channels.createMessage(newConfig.log_channel_id || newConfig.honeypot_channel_id, {
                            content: `There was a problem sending a message to the <#${newConfig.honeypot_channel_id}> channel for the "Channel Warmer" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        });
                    }
                }
                if (
                    (!prevConfig?.experiments.includes("random-channel-name") && newConfig.experiments.includes("random-channel-name"))
                    || (!prevConfig?.experiments.includes("random-channel-name-chaos") && newConfig.experiments.includes("random-channel-name-chaos"))
                ) {
                    try {
                        await randomChannelNameExperiment(api, guildId, newConfig.honeypot_channel_id!, newConfig.experiments.includes("random-channel-name-chaos"))
                    } catch (err) {
                        return await api.channels.createMessage(newConfig.log_channel_id || newConfig.honeypot_channel_id, {
                            content: `There was a problem updating the <#${newConfig.honeypot_channel_id}> channel for the "Random Channel Name" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        });
                    }
                }
                return;
            }

            // slash command handler: show modal
            if (guildId && interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot-messages") {
                let config = await getHoneypotMessages(guildId);

                const modal: APIModalInteractionResponseCallbackData = {
                    title: "Honeypot's Messages",
                    custom_id: `honeypot_messages_modal`,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: "Set custom messages for the honeypot bot:\n" +
                                "-# - You can use the variables in your messages shown in template/default text\n" +
                                "-# - If you leave the textbox empty, then it'll reset to default\n" +
                                "-# - Make sure to keep the messages clear and informative!"
                        },
                        {
                            type: ComponentType.Label,
                            label: "Honeypot Warning",
                            description: "This is the message shown in the honeypot channel",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "honeypot_warning",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 1500,
                                required: false,
                                value: config?.warning_message || defaultHoneypotWarningMessage,
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Honeypot DM Message",
                            description: "This is the message sent to users via DM when they trigger the honeypot",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "honeypot_dm_message",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 1000,
                                required: false,
                                value: config?.dm_message || defaultHoneypotUserDMMessage,
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Log Message",
                            description: "This is the message shown in the log channel",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "log_message",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 500,
                                required: false,
                                value: config?.log_message || defaultLogActionMessage,
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Reset All Messages",
                            description: "Nothing you changed here will persist. This will reset all messages to their default values.",
                            component: {
                                type: ComponentType.Checkbox,
                                custom_id: "reset_messages",
                                default: false
                            },
                        },
                    ]
                };
                await api.interactions.createModal(interaction.id, interaction.token, modal);
                return;
            }

            // modal submit handler: update config from modal values
            else if (guildId && interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_messages_modal`) {
                const newMessages: Awaited<ReturnType<typeof getHoneypotMessages>> = {
                    dm_message: null,
                    warning_message: null,
                    log_message: null,
                }
                let reset = false;

                for (const label of interaction.data.components) {
                    if (label.type !== ComponentType.Label) continue;
                    const c = (label).component ?? label;
                    if (!c || reset) continue;

                    if (c.type === ComponentType.TextInput) {
                        if (c.custom_id === "honeypot_warning" && c.value.length) {
                            if (c.value !== defaultHoneypotWarningMessage) newMessages.warning_message = c.value;
                        }
                        if (c.custom_id === "honeypot_dm_message" && c.value.length) {
                            if (c.value !== defaultHoneypotUserDMMessage) newMessages.dm_message = c.value;
                        }
                        if (c.custom_id === "log_message" && c.value.length) {
                            if (c.value !== defaultLogActionMessage) newMessages.log_message = c.value;
                        };
                    }
                    if (c.type === ComponentType.Checkbox) {
                        if (c.custom_id === "reset_messages" && c.value) {
                            reset = true;
                            newMessages.dm_message = null;
                            newMessages.warning_message = null;
                            newMessages.log_message = null;
                        }
                    }
                }

                // test that the messages are "safe" with rudimentary checks for bad words
                const warningMsgSus = newMessages.warning_message ? containsBadWord(newMessages.warning_message) : false;
                const dmMsgSus = newMessages.dm_message ? containsBadWord(newMessages.dm_message) : false;
                const logMsgSus = newMessages.log_message ? containsBadWord(newMessages.log_message) : false;
                if (warningMsgSus || dmMsgSus || logMsgSus) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: `One or more of your messages contain words that are not allowed on Discord. Please remove any inappropriate language and try again.\n-# No changes have been saved.`,
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const config = await getConfig(guildId);
                if (config?.honeypot_channel_id && config?.honeypot_msg_id) {
                    try {
                        const guildModeratedCount = await getModeratedCount(guildId);
                        await api.channels.editMessage(
                            config.honeypot_channel_id,
                            config.honeypot_msg_id,
                            honeypotWarningMessage(guildModeratedCount, config.action, newMessages.warning_message)
                        );
                    } catch (err) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `There was a problem updating the honeypot warning message in <#${config.honeypot_channel_id}>. Please check my permissions.\n-# Your custom messages have not been saved.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });

                        return
                    }
                }

                await api.interactions.reply(interaction.id, interaction.token, {
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: "**Honeypot messages updated!**",
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.warning_message ? "Warning Message" : "Warning Message: *(Using default)*",
                        },
                        newMessages.warning_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.warning_message
                                }
                            ],
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.dm_message ? "DM Message" : "DM Message: *(Using default)*",
                        },
                        newMessages.dm_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.dm_message
                                }
                            ],
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.log_message ? "Log Message" : "Log Message: *(Using default)*",
                        },
                        newMessages.log_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.log_message
                                }
                            ],
                        },
                    ].filter(e => !!e),

                    allowed_mentions: {},
                } as RESTPostAPIChannelMessageJSONBody);

                const existingMessages = await getHoneypotMessages(guildId);
                await setHoneypotMessages(guildId, newMessages);

                if (newMessages.dm_message && existingMessages?.dm_message !== newMessages.dm_message) {
                    const timeout = AbortSignal.timeout(10_000);
                    const userId = (interaction.user || interaction.member?.user)?.id;
                    if (userId) {
                        try {
                            const server = await getGuildInfo(api, guildId, timeout);
                            const { id: dmChannel } = await api.users.createDM(userId, { signal: timeout });
                            await api.channels.createMessage(
                                dmChannel,
                                honeypotUserDMMessage(
                                    config?.action || "softban",
                                    server?.name ?? guildId!,
                                    server.vanityInviteCode ? `https://discord.gg/${server.vanityInviteCode}` : undefined,
                                    `https://discord.com/channels/${guildId}/${config?.honeypot_channel_id || ""}/${config?.honeypot_msg_id || ""}`,
                                    false,
                                    newMessages.dm_message,
                                    true
                                ),
                                { signal: timeout }
                            );
                        } catch (err) {
                            console.log(`Error sending example DM message: ${err}`);
                        }
                    }
                }

                return;
            }

            // dm command to show stats
            else if (interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "stats") {
                const { totalGuilds, totalModerated } = await getStats();
                const userId = (interaction.user || interaction.member?.user)?.id
                const userModeratedCount = userId ? await getUserModeratedCount(userId) : 0;

                await api.interactions.reply(interaction.id, interaction.token, {
                    flags: MessageFlags.IsComponentsV2,
                    allowed_mentions: {},
                    components: [
                        {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: [
                                        `## ${CUSTOM_EMOJI} Honeypot Bot Statistics ${CUSTOM_EMOJI}`,
                                        "",
                                        `Total servers: \`${totalGuilds.toLocaleString()}\``,
                                        `Total moderations: \`${totalModerated.toLocaleString()}\``,
                                        `Times you've been #honeypot'd: \`${(userModeratedCount || 0).toLocaleString()}\``,
                                    ].join("\n"),
                                },
                                {
                                    type: ComponentType.TextDisplay,
                                    content: "-# Thank you for using [Honeypot Bot](https://discord.com/discovery/applications/1450060292716494940) to keep your servers safe from unwanted bots!"
                                },
                                {
                                    type: ComponentType.ActionRow,
                                    components: [
                                        {
                                            type: ComponentType.Button,
                                            url: `https://discord.com/oauth2/authorize?client_id=${interaction.application_id}`,
                                            style: ButtonStyle.Link,
                                            label: "Invite Bot",
                                            emoji: { name: "honeypot", id: CUSTOM_EMOJI_ID }
                                        },
                                        {
                                            type: ComponentType.Button,
                                            url: "https://discord.gg/BanFeVWyFP",
                                            style: ButtonStyle.Link,
                                            label: "Support Server"
                                        },
                                        {
                                            type: ComponentType.Button,
                                            url: "https://riskymh.dev",
                                            style: ButtonStyle.Link,
                                            label: "riskymh.dev"
                                        },
                                    ]
                                },
                            ],
                        },
                    ]
                });
            }

            return;
        } catch (err) {
            console.error(`Error with InteractionCreate handler: ${err}`);
        }
    }
};

export default handler;
