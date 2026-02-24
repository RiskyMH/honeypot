import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from "discord-api-types/v10";

export const commandsPayload = [
    {
        // this command opens a modal for configuring the honeypot
        name: "honeypot",
        description: "Configure honeypot settings",
        type: ApplicationCommandType.ChatInput,
        options: [],
        default_member_permissions:
            (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels).toString(),
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    {
        // this command opens a modal for configuring the messages
        name: "honeypot-messages",
        description: "Configure honeypot messages",
        type: ApplicationCommandType.ChatInput,
        options: [],
        default_member_permissions:
            (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels).toString(),
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    {
        name: "stats",
        description: "See statistics all servers using honeypot",
        type: ApplicationCommandType.ChatInput,
        options: [],
        contexts: [InteractionContextType.BotDM],
    },
]

