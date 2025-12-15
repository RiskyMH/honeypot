import { type RESTPostAPIChannelMessageJSONBody, MessageFlags, ComponentType, ButtonStyle } from "discord-api-types/v10";

export function honeypotWarningMessage(
  bansCount: number = 0,
  action: 'ban' | 'timeout' | 'kick' | 'disabled' = 'ban'
): RESTPostAPIChannelMessageJSONBody {
  const actionTextMap = {
    ban: { text: 'an immediate ban', label: 'Bans' },
    timeout: { text: 'a 24h timeout and message deletion', label: 'Timeouts' },
    kick: { text: 'an immediate kick and message deletion', label: 'Kicks' },
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
                content: `## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in ${actionText}.`
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
                label: `${labelText}: ${bansCount}`,
                custom_id: "bans_count",
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
