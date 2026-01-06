import { SQL } from "bun";

export type HoneypotConfig = {
  guild_id: string;
  honeypot_channel_id: string | null;
  honeypot_msg_id: string | null;
  log_channel_id: string | null;
  action: 'softban' | 'ban' | 'disabled';
};

export const db = new SQL(process.env.DATABASE_URL || "sqlite://honeypot.sqlite");

export async function initDb() {
  await db`PRAGMA foreign_keys = ON;`.catch(() => { });
  await db`
    CREATE TABLE IF NOT EXISTS honeypot_config (
      guild_id TEXT PRIMARY KEY,
      honeypot_channel_id TEXT,
      honeypot_msg_id TEXT,
      log_channel_id TEXT,
      action TEXT NOT NULL DEFAULT 'softban'
    );
  `;
  await db`
    CREATE TABLE IF NOT EXISTS honeypot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
    );
  `;
}

export async function getConfig(guild_id: string): Promise<HoneypotConfig | null> {
  const [row] = await db`SELECT * FROM honeypot_config WHERE guild_id = ${guild_id}`;
  if (!row) return null;
  return {
    guild_id: row.guild_id,
    honeypot_channel_id: row.honeypot_channel_id,
    honeypot_msg_id: row.honeypot_msg_id ?? null,
    log_channel_id: row.log_channel_id ?? null,
    action: ['softban', 'ban', 'disabled'].includes(row.action) ? row.action : 'softban',
  };
}

export async function setConfig(config: HoneypotConfig) {
  await db`
    INSERT INTO honeypot_config (guild_id, honeypot_channel_id, honeypot_msg_id, log_channel_id, action)
    VALUES (${config.guild_id}, ${config.honeypot_channel_id}, ${config.honeypot_msg_id}, ${config.log_channel_id}, ${config.action})
    ON CONFLICT(guild_id) DO UPDATE SET
      honeypot_channel_id=excluded.honeypot_channel_id,
      honeypot_msg_id=excluded.honeypot_msg_id,
      log_channel_id=excluded.log_channel_id,
      action=excluded.action
  `;
}

export async function deleteConfig(guild_id: string) {
  await db`DELETE FROM honeypot_config WHERE guild_id = ${guild_id}`;
}

export async function logModerateEvent(guild_id: string, user_id: string) {
  await db`INSERT INTO honeypot_events (guild_id, user_id) VALUES (${guild_id}, ${user_id})`;
}

export async function getModeratedCount(guild_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE guild_id = ${guild_id}`;
  return row.count as number;
}

export async function unsetHoneypotChannel(guildId: string, channelId: string) {
  await db`UPDATE honeypot_config SET honeypot_channel_id = NULL, honeypot_msg_id = NULL WHERE guild_id = ${guildId} AND honeypot_channel_id = ${channelId}`;
}

export async function unsetLogChannel(guildId: string, channelId: string) {
  await db`UPDATE honeypot_config SET log_channel_id = NULL WHERE guild_id = ${guildId} AND log_channel_id = ${channelId}`;
}

export async function unsetHoneypotMsg(guildId: string, messageId: string) {
  await db`UPDATE honeypot_config SET honeypot_msg_id = NULL WHERE guild_id = ${guildId} AND honeypot_msg_id = ${messageId}`;
}

export async function getStats(): Promise<{ totalGuilds: number; totalModerated: number; }> {
  const result = await db`SELECT (SELECT COUNT(*) FROM honeypot_config) AS config_count, (SELECT MAX(id) FROM honeypot_events) AS event_count;`;
  return {
    totalGuilds: result[0].config_count as number,
    totalModerated: result[0].event_count as number,
  };
}

export async function getUserModeratedCount(user_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE user_id = ${user_id}`;
  return row.count as number;
}