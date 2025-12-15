import { SQL } from "bun";

export type HoneypotConfig = {
  guild_id: string;
  honeypot_channel_id: string;
  honeypot_msg_id: string | null;
  admin_channel_id: string | null;
  action: 'ban' | 'timeout' | 'disabled' | 'kick';
};

export const db = new SQL(process.env.DATABASE_URL || "sqlite://honeypot.sqlite");

export async function initDb() {
  await db`
    CREATE TABLE IF NOT EXISTS honeypot_config (
      guild_id TEXT PRIMARY KEY,
      honeypot_channel_id TEXT NOT NULL,
      honeypot_msg_id TEXT,
      admin_channel_id TEXT,
      action TEXT NOT NULL DEFAULT 'ban'
    );
  `;
  await db`
    CREATE TABLE IF NOT EXISTS honeypot_ban_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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
    admin_channel_id: row.admin_channel_id ?? null,
    action: row.action === 'timeout' ? 'timeout' : row.action === 'disabled' ? 'disabled' : 'ban',
  };
}

export async function setConfig(config: HoneypotConfig) {
  await db`
    INSERT INTO honeypot_config (guild_id, honeypot_channel_id, honeypot_msg_id, admin_channel_id, action)
    VALUES (${config.guild_id}, ${config.honeypot_channel_id}, ${config.honeypot_msg_id}, ${config.admin_channel_id}, ${config.action})
    ON CONFLICT(guild_id) DO UPDATE SET
      honeypot_channel_id=excluded.honeypot_channel_id,
      honeypot_msg_id=excluded.honeypot_msg_id,
      admin_channel_id=excluded.admin_channel_id,
      action=excluded.action
  `;
}

export async function logBanEvent(guild_id: string, user_id: string) {
  await db`INSERT INTO honeypot_ban_events (guild_id, user_id) VALUES (${guild_id}, ${user_id})`;
}

export async function getBanCount(guild_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_ban_events WHERE guild_id = ${guild_id}`;
  return row.count as number;
}