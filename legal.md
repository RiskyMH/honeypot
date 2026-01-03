# Legal for Honeypot Discord Bot

> **Note:** This policy is subject to change. For material changes affecting data handling or user rights, an updated policy will be published here and/or announced in the support Discord server.

**Official instance info**

- This Privacy Policy and Terms of Service apply only to the official Honeypot Discord bot operated by RiskyMH (https://riskymh.dev).  
- The official bot’s invite link is: https://discord.com/oauth2/authorize?client_id=1450060292716494940  
- The official bot’s user ID is: `1450060292716494940`

- If you are using a forked, self-hosted, or otherwise modified version, this policy does not apply. Please contact the respective operator for their privacy policy and terms.

## Privacy Policy 

**Last Updated: January 3, 2026**

[RiskyMH](https://riskymh.dev) operates the Honeypot Discord bot. This Privacy Policy explains exactly what data the bot collects, stores, and uses.

### Information We Collect

The bot stores only the minimum data needed to function in a local SQLite database:

- Server ID, honeypot channel ID, warning message ID, optional log channel ID, and action setting ('softban', 'ban', or 'disabled')
- User IDs and timestamps for users who trigger the honeypot (only for counter display)

Usernames, server names, and other details fetched from Discord's API are used in memory only and never stored.

### How We Use Your Information

This data powers the bot's core functions:
- Monitor the designated honeypot channel
- Execute the configured moderation action (ban, softban, or disabled)
- Update the warning message counter
- Log events to the configured channel when set

### Data Storage and Retention

Data is stored in a single local SQLite file. All server data is automatically deleted when the bot is removed from a server. No backups or cloud storage are used.

### What We Do Not Collect

- Message contents
- Full member lists  
- Activity outside the honeypot channel
- Private messages or voice data
- IP addresses or account details
- File attachments

### Third-Party Sharing

No data is shared with any third parties. All processing happens through Discord's API.

### Discord's Role

The bot uses Discord's API. [Discord's Privacy Policy](https://discord.com/privacy) applies to their platform data.

### Your Rights

Server owners can remove the bot at any time, which automatically deletes all associated data. Settings are configurable via the `/honeypot` command.

### Security

Data stays on the bot's local server with Discord API encryption. No external databases or file uploads are processed.

---

## Terms of Service

**Last Updated: January 3, 2026**

### Acceptance of Terms

Adding Honeypot to your Discord server means you agree to these Terms of Service.

### Description of Service

Honeypot monitors a designated channel and automatically moderates users who post there according to your settings.

### Required Permissions

The bot needs:
- View Channels (to monitor honeypot)
- Send Messages (for logs and warning message)
- Manage Channels (to create honeypot channel)
- Ban Members (to execute moderation)

### Prohibited Uses

Do not use Honeypot to:
- Violate Discord's Terms of Service
- Target or harass specific users
- Evade moderation in other servers

### Owner Responsibilities

Ensure the bot's role is positioned above members' highest roles and has Ban Members permission. Review moderation logs for accuracy.

### Limitation of Liability

Honeypot is provided "as is" without warranties. We are not responsible for false positives, Discord API issues, permission errors, or data loss from platform problems.

### Termination

Remove the bot from your server to stop service and delete all data. We may remove the bot from servers violating these terms.

### Governing Law

Disputes are governed by the laws of Australia.

### Contact

For support, join the Discord server https://discord.gg/qK9pfnB3Yv or contact the owner RiskyMH at https://riskymh.dev.
