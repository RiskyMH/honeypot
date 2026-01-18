import { type RESTPostAPIChannelMessageJSONBody, MessageFlags, ComponentType, ButtonStyle } from "discord-api-types/v10";
import type { HoneypotConfig } from "./db";

export function honeypotWarningMessage(
  moderatedCount: number = 0,
  action: HoneypotConfig["action"] = 'softban',
  customText?: string | null
): RESTPostAPIChannelMessageJSONBody {
  const actionTextMap = {
    ban: { text: 'an immediate ban', label: 'Bans' },
    softban: { text: 'a softban', label: 'Kicks' },
    kick: { text: 'a softban', label: 'Kicks' },
    disabled: { text: 'no action (honeypot is disabled)', label: 'Triggers' }
  };
  const { text: actionText, label: labelText } = actionTextMap[action] || actionTextMap.ban!;

  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: customText?.replaceAll("{{action:text}}", actionText)
                  || `## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in **${actionText}**.`
              }
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/refs/heads/main/assets/Honey%20pot/3D/honey_pot_3d.png"
              }
            }
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: `${labelText}: ${moderatedCount}`,
                custom_id: "moderated_count_button",
                disabled: true,
                emoji: { name: "🍯" }
              }
            ]
          }
        ],
      },
    ]
  };
}

export const defauultHoneypotWarningMessage = "## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in **{{action:text}}**.";

export function honeypotUserDMMessage(actionText: string, guildName: string, action: string, link: string, isOwner = false, customText?: string | null): RESTPostAPIChannelMessageJSONBody {
  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        accent_color: 0xFFD700,
        components: [
          {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: customText?.replaceAll("{{action:text}}", actionText).replaceAll("{{server:name}}", guildName).replaceAll("{{honeypot:channel:link}}", link)
                  || `## Honeypot Triggered\n\nYou have been **${actionText}** from ${guildName} for sending a message in the [honeypot](${link}) channel.`
              },
              {
                type: ComponentType.TextDisplay,
                content: `-# This is an automated message. Replies are not monitored.`
              },
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/refs/heads/main/assets/Honey%20pot/3D/honey_pot_3d.png"
              }
            }
          }
        ]
      },
      customText ? {
        type: ComponentType.TextDisplay,
        content: `-# This is a custom message from the owners of ${guildName}.`
      } : null,
      isOwner ? {
        type: ComponentType.TextDisplay,
        content: `-# This is an example message: as the owner you can’t be ${actionText}.`
      } : null
    ].filter(Boolean) as any[],
  };
}

export const defaultHoneypotUserDMMessage = "## Honeypot Triggered\n\nYou have been **{{action:text}}** from {{server:name}} for sending a message in the [honeypot]({{honeypot:channel:link}}) channel.";
