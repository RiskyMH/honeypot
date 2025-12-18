
<h1 align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1450060292716494940" target="_blank">
    <img src="https://raw.githubusercontent.com/microsoft/fluentui-emoji/refs/heads/main/assets/Honey%20pot/3D/honey_pot_3d.png" alt="Honey Pot Emoji" width="84">
  </a>
  <br>
  Honeypot Discord Bot
</h1>

> A Discord bot to automatically catch and remove spam bots by monitoring a dedicated "#honeypot" channel.

## Usage

1. [**Invite the bot**](https://discord.com/oauth2/authorize?client_id=1450060292716494940) to your server with appropriate permissions (Ban Members, Manage Channels, etc).
2. The bot will create a `#honeypot` channel on join, or you can set it up with `/honeypot`.
3. Configure the admin log channel and action (kick or ban) using the `/honeypot` command.
4. Ensure the bot’s highest role is above any self-assignable (color/ping) roles.
5. Any user posting in the honeypot channel will be banned or removed, and the action will be logged.
> **Note:** Kick is default and is a softban (bans & unbans) so Discord deletes their immediate messages 

## Getting Started (dev)

- [Bun](https://bun.sh/) (v1.3+)
- Discord bot token (set as `DISCORD_TOKEN` environment variable)

```bash
bun install

bun start
```
