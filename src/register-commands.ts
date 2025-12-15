import type { API } from "@discordjs/core";
import { ApplicationCommandType, ApplicationCommandOptionType, ChannelType, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from "discord-api-types/v10";

export async function registerCommands(api: API, applicationId: string) {
  await api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, [
    {
      name: "honeypot",
      description: "Configure honeypot settings",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          name: "channel",
          description: "Set honeypot channel",
          type: ApplicationCommandOptionType.Channel,
          channel_types: [ChannelType.GuildText],
          required: false,
        },
        {
          name: "admin_channel",
          description: "Set admin log channel",
          type: ApplicationCommandOptionType.Channel,
          channel_types: [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildVoice],
          required: false,
        },
        {
          name: "action",
          description: "Action to take on trigger (all except disabled delete their last hour of messages)",
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: "Ban (permanent, delete last 1hr msgs)", value: "ban" },
            { name: "Timeout (for 24h, delete last 1hr msgs)", value: "timeout" },
            { name: "Kick (delete last 1hr msgs)", value: "kick" },
            { name: "Disabled", value: "disabled" }
          ]
        },
      ],
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild],
    },
  ]);
}
