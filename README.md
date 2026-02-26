
<h1 align="center">
  <a href="https://discord.com/discovery/applications/1450060292716494940" target="_blank">
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

<details>
<summary><strong>Extra info</strong></summary>
  
### Why use a Honeypot Bot?

Spammers and compromised accounts often target all channels at once, especially from accounts already inside your server. This bot makes it easy to automatically spot and remove these accounts. When someone posts in the honeypot channel, the bot acts immediately - removing them and deleting their messages before they can spread spam further. This saves you and your moderators time, reduces spam exposure to your community, and keeps your server running smoothly.

> *"The bot that shouldn't need to exist"* - someone, probably

### Experiments

Options you can enable to avoid the bots better

1. **Channel Warmer:** Keep the honeypot channel active (every day)
1. **Random Channel Name:** Randomize the honeypot channel name (every day)
1. **Random Channel Name (chaos):** Randomize the honeypot channel name with random characters (every day)
1. **No Warning Msg:** Don’t include a warning message in the #honeypot channel
1. **No DM:** Don’t DM the user that they triggered the honeypot

### Tips to Maximize Honeypot Bot’s Effectiveness

For best results, position your *#honeypot* channel near the top of your server list - recent spam bots often target the first few channels available. Consider renaming the *trap channel* to something less predictable, like *#pls-dont-chat-here*, to avoid automated bots that blacklist *"honeypot"* by name. Always ensure the bot’s role is ranked above standard member roles; this ensures it has the authority to remove problematic accounts. Explore the experimental features for additional defenses against evolving bot tactics, and enjoy a cleaner, safer community - so you can say goodbye to unwanted bots! 🎉

</details>

## Getting Started (dev)

- [Bun](https://bun.sh/) (v1.3+)
- Discord bot token (set as `DISCORD_TOKEN` environment variable)

```bash
$ bun install
$ bun start # or `bun dev`
```
