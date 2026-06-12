import { SQL } from "bun";

export type HoneypotConfig = {
  guild_id: string;
  log_channel_id: string | null;
  action: 'softban' | 'ban' | 'disabled';
  experiments: (
    "no-warning-msg" |
    "no-dm" |
    "random-channel-name" |
    "random-channel-name-chaos" |
    "channel-warmer" |
    "forward-message" |
    "reinvite" |
    "timeout-first" |
    "only-recent-delete" |
    "many-honeypots"
  )[]
};

export type HoneypotChannel = {
  guild_id: string;
  channel_id: string;
  msg_id: string | null;
};

export type ConfigWithChannels = {
  config: HoneypotConfig;
  channels: HoneypotChannel[];
};

export const db = new SQL(process.env.DATABASE_URL || "sqlite://honeypot.sqlite", {
  readonly: process.env.DATABASE_READONLY === "true" ? true : undefined,
  bigint: true, // bigits as bigint (postgres/mysql)
  safeIntegers: true, // numbers as bigint (sqlite)
});

interface Migration {
  version: number;
  name: string;
  up: (tx: SQL) => Promise<void>;
}

const autoincrementSyntax = db.options.adapter === "sqlite" ? db`AUTOINCREMENT` : db.options.adapter === "postgres" ? db`GENERATED ALWAYS AS IDENTITY` : db`AUTO_INCREMENT`

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial",
    up: async (tx) => {
      await tx`
CREATE TABLE IF NOT EXISTS honeypot_config (
  guild_id TEXT PRIMARY KEY,
  honeypot_channel_id TEXT,
  honeypot_msg_id TEXT,
  log_channel_id TEXT,
  action TEXT NOT NULL DEFAULT 'softban',
  experiments VARCHAR(255) DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS honeypot_events (
  id INTEGER PRIMARY KEY ${autoincrementSyntax},
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS honeypot_messages (
  guild_id TEXT PRIMARY KEY,
  warning_message TEXT,
  dm_message TEXT,
  log_message TEXT,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS honeypot_reinvite (
  guild_id TEXT PRIMARY KEY,
  invite TEXT,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_honeypot_events_guild_id ON honeypot_events(guild_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_user_id ON honeypot_events(user_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_speed ON honeypot_events(timestamp, guild_id);
`;
    },
  },
  {
    version: 2,
    name: "honeypot_channels",
    up: async (tx) => {
      await tx`
CREATE TABLE IF NOT EXISTS honeypot_channels (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  msg_id TEXT,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);

ALTER TABLE honeypot_events ADD COLUMN channel_id TEXT;
`;
      await tx`
INSERT OR IGNORE INTO honeypot_channels (guild_id, channel_id, msg_id)
SELECT guild_id, honeypot_channel_id, honeypot_msg_id
FROM honeypot_config
WHERE honeypot_channel_id IS NOT NULL;
`;
      await tx`
CREATE INDEX IF NOT EXISTS idx_honeypot_channels_channel_id ON honeypot_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_channels_guild_id ON honeypot_channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_channel_id ON honeypot_events(channel_id);

ALTER TABLE honeypot_config DROP COLUMN honeypot_channel_id;
ALTER TABLE honeypot_config DROP COLUMN honeypot_msg_id;
`;
      await tx`
UPDATE honeypot_events
SET channel_id = (
  SELECT channel_id FROM honeypot_channels
  WHERE honeypot_channels.guild_id = honeypot_events.guild_id
)
WHERE channel_id IS NULL
AND EXISTS (
  SELECT 1 FROM honeypot_channels
  WHERE honeypot_channels.guild_id = honeypot_events.guild_id
);`;

    },
  },
  {
    version: 3,
    name: "snowflakes_to_bigint",
    up: async (tx) => {
      await tx`
CREATE TABLE IF NOT EXISTS hc_new (
  guild_id BIGINT PRIMARY KEY,
  log_channel_id BIGINT,
  action TEXT NOT NULL DEFAULT 'softban',
  experiments VARCHAR(255) DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS hch_new (
  channel_id BIGINT PRIMARY KEY,
  guild_id BIGINT NOT NULL,
  msg_id BIGINT,
  FOREIGN KEY (guild_id) REFERENCES hc_new(guild_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS he_new (
  id INTEGER PRIMARY KEY ${autoincrementSyntax},
  guild_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  channel_id BIGINT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guild_id) REFERENCES hc_new(guild_id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES hch_new(channel_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hm_new (
  guild_id BIGINT PRIMARY KEY,
  warning_message TEXT,
  dm_message TEXT,
  log_message TEXT,
  FOREIGN KEY (guild_id) REFERENCES hc_new(guild_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hr_new (
  guild_id BIGINT PRIMARY KEY,
  invite TEXT,
  FOREIGN KEY (guild_id) REFERENCES hc_new(guild_id) ON DELETE CASCADE
);
`;
      await tx`INSERT INTO hc_new SELECT CAST(guild_id AS BIGINT), CAST(log_channel_id AS BIGINT), action, experiments FROM honeypot_config;`
      await tx`INSERT INTO hch_new SELECT CAST(channel_id AS BIGINT), CAST(guild_id AS BIGINT), CAST(msg_id AS BIGINT) FROM honeypot_channels;`
      await tx`INSERT INTO he_new SELECT id, CAST(guild_id AS BIGINT), CAST(user_id AS BIGINT), CAST(channel_id AS BIGINT), timestamp FROM honeypot_events;`
      await tx`INSERT INTO hm_new SELECT CAST(guild_id AS BIGINT), warning_message, dm_message, log_message FROM honeypot_messages;`
      await tx`INSERT INTO hr_new SELECT CAST(guild_id AS BIGINT), invite FROM honeypot_reinvite;`

      await tx`
DROP TABLE honeypot_config;
DROP TABLE honeypot_channels;
DROP TABLE honeypot_events;
DROP TABLE honeypot_messages;
DROP TABLE honeypot_reinvite;

ALTER TABLE hc_new RENAME TO honeypot_config;
ALTER TABLE hch_new RENAME TO honeypot_channels;
ALTER TABLE he_new RENAME TO honeypot_events;
ALTER TABLE hm_new RENAME TO honeypot_messages;
ALTER TABLE hr_new RENAME TO honeypot_reinvite;
`;

      await tx`
CREATE INDEX IF NOT EXISTS idx_honeypot_channels_channel_id ON honeypot_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_channels_guild_id ON honeypot_channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_guild_id ON honeypot_events(guild_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_user_id ON honeypot_events(user_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_channel_id ON honeypot_events(guild_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_stats ON honeypot_events(timestamp, guild_id);
    `;
    },
  }
];

export async function initDb() {
  if (db.options.adapter === "sqlite") {
    try {
      await db`PRAGMA foreign_keys = ON;`;
      await db`PRAGMA journal_mode = WAL;`;
      await db`PRAGMA busy_timeout = 5000;`;
      await db`PRAGMA wal_autocheckpoint = 1000;`;
      await db`PRAGMA synchronous = NORMAL;`;
    } catch (err) {
      console.error("Failed to set PRAGMA settings:", err);
    }
  }

  // it'll fail in migrating anyway
  if (process.env.DATABASE_READONLY === "true") return;

  await db`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`;

  const applied: { version: bigint | number }[] = await db`SELECT version FROM _migrations ORDER BY version ASC`.catch(() => [])
  const appliedSet = new Set(applied.map(r => Number(r.version)));

  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;
    try {
      await db.begin(async (tx) => {
        await m.up(tx);
        await tx`INSERT INTO _migrations (version, name) VALUES (${m.version}, ${m.name})`;
      });
      if (appliedSet.size > 0) {
        console.log(`[db migrate] ${m.version}: ${m.name} applied`);
      }
    } catch (err) {
      console.error(`[db migrate] ${m.version}: ${m.name} failed:`, err);
      throw err;
    }
  }

  if (appliedSet.size > 0 && appliedSet.size !== migrations.length) {
    if (db.options.adapter === "sqlite") await db`VACUUM;`.catch(() => { });
    console.log(`[db migrate] All migrations applied successfully`);
  }
}

function parseConfigRow(row: any): HoneypotConfig {
  return {
    guild_id: row.guild_id.toString(),
    log_channel_id: row.log_channel_id?.toString() ?? null,
    action: ['softban', 'ban', 'disabled'].includes(row.action) ? row.action : 'softban',
    experiments: JSON.parse(row.experiments || '[]'),
  };
}

export async function getConfig(guild_id: string): Promise<HoneypotConfig | null> {
  const [row] = await db`SELECT guild_id, log_channel_id, action, experiments FROM honeypot_config WHERE guild_id = ${guild_id}`;
  if (!row) return null;
  return parseConfigRow(row);
}

export async function getChannels(guild_id: string): Promise<HoneypotChannel[]> {
  const rows = await db`SELECT * FROM honeypot_channels WHERE guild_id = ${guild_id} ORDER BY channel_id`;
  return rows.map((r: any) => ({ guild_id: r.guild_id.toString(), channel_id: r.channel_id.toString(), msg_id: r.msg_id?.toString() ?? null }));
}

export async function getConfigWithChannels(guild_id: string): Promise<ConfigWithChannels | null> {
  const rows = await db`
    SELECT cfg.*, ch.channel_id AS ch_channel_id, ch.msg_id AS ch_msg_id
    FROM honeypot_config cfg
    LEFT JOIN honeypot_channels ch ON ch.guild_id = cfg.guild_id
    WHERE cfg.guild_id = ${guild_id}
  `;
  if (rows.length === 0) return null;
  const config = parseConfigRow(rows[0]);
  const channels: HoneypotChannel[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const ch_channel_id = r.ch_channel_id?.toString() ?? null;
    if (r.ch_channel_id && !seen.has(ch_channel_id)) {
      seen.add(ch_channel_id);
      channels.push({ guild_id, channel_id: ch_channel_id, msg_id: r.ch_msg_id?.toString() ?? null });
    }
  }
  return { config, channels };
}

export async function setConfig(config: HoneypotConfig) {
  await db`
    INSERT INTO honeypot_config (guild_id, log_channel_id, action, experiments)
    VALUES (${config.guild_id}, ${config.log_channel_id}, ${config.action}, ${JSON.stringify(config.experiments || [])})
    ON CONFLICT(guild_id) DO UPDATE SET
      log_channel_id=excluded.log_channel_id,
      action=excluded.action,
      experiments=excluded.experiments
  `;
}

export async function deleteConfig(guild_id: string) {
  await db`DELETE FROM honeypot_config WHERE guild_id = ${guild_id}`;
}

export async function logModerateEvent(guild_id: string, user_id: string, channel_id?: string) {
  await db`INSERT INTO honeypot_events (guild_id, user_id, channel_id) VALUES (${guild_id}, ${user_id}, ${channel_id ?? null})`;
}

export async function getModeratedCount(guild_id: string, channel_id?: string | null): Promise<number> {
  if (channel_id) {
    const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE guild_id = ${guild_id} AND channel_id = ${channel_id}`;
    return row.count as number;
  } else {
    const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE guild_id = ${guild_id}`;
    return row.count as number;
  }
}

export async function unsetHoneypotChannel(guildId: string, channelId: string) {
  await db`DELETE FROM honeypot_channels WHERE guild_id = ${guildId} AND channel_id = ${channelId}`;
}

export async function unsetLogChannel(guildId: string, channelId: string) {
  await db`UPDATE honeypot_config SET log_channel_id = NULL WHERE guild_id = ${guildId} AND log_channel_id = ${channelId}`;
}

export async function unsetHoneypotMsg(guildId: string, messageId: string) {
  const row = await db`SELECT 1 FROM honeypot_channels WHERE guild_id = ${guildId} AND msg_id = ${messageId}`;
  if (row.length === 0) return;

  await db`UPDATE honeypot_channels SET msg_id = NULL WHERE guild_id = ${guildId} AND msg_id = ${messageId}`;
}

export async function unsetHoneypotMsgs(guildId: string, messageIds: string[]) {
  const row = await db`SELECT 1 FROM honeypot_channels WHERE guild_id = ${guildId} AND msg_id IN ${db(messageIds)}`;
  if (row.length === 0) return;

  await db`UPDATE honeypot_channels SET msg_id = NULL WHERE guild_id = ${guildId} AND msg_id IN ${db(messageIds)}`;
}

export async function setHoneypotChannels(guild_id: string, channels: { channel_id: string; msg_id?: string | null }[]) {
  if (channels.length === 0) {
    await db`DELETE FROM honeypot_channels WHERE guild_id = ${guild_id}`;
    return;
  }
  await db.begin(async (tx) => {
    await tx`DELETE FROM honeypot_channels WHERE guild_id = ${guild_id} AND channel_id NOT IN ${db(channels.map(c => c.channel_id))}`;
    await tx`
        INSERT INTO honeypot_channels ${tx(
      channels.map(c => ({
        channel_id: c.channel_id,
        guild_id,
        msg_id: c.msg_id ?? null
      }))
    )}
        ON CONFLICT(channel_id)
        DO UPDATE SET msg_id=excluded.msg_id
      `;
  });
}

export async function getStats(): Promise<{ totalGuilds: number; totalModerated: number; }> {
  const [result] = await db`SELECT (SELECT COUNT(*) FROM honeypot_config) AS config_count, (SELECT COUNT(*) FROM honeypot_events) AS event_count;`;
  return {
    totalGuilds: result.config_count,
    totalModerated: result.event_count,
  };
}

export async function getUserModeratedCount(user_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE user_id = ${user_id}`;
  return row.count as number;
}

export async function getGuildsWithExperiment(experiment: HoneypotConfig["experiments"][number]): Promise<HoneypotConfig[]> {
  const rows = await db`SELECT guild_id, log_channel_id, action, experiments FROM honeypot_config WHERE experiments LIKE '%' || ${experiment} || '%'`;
  return rows.map((row: any) => parseConfigRow(row));
}
export async function getHoneypotMessages(guild_id: string): Promise<{ warning_message: string | null; dm_message: string | null; log_message: string | null; }> {
  const [row] = await db`SELECT * FROM honeypot_messages WHERE guild_id = ${guild_id}`;
  if (!row) {
    return {
      warning_message: null,
      dm_message: null,
      log_message: null,
    };
  }
  return {
    warning_message: row.warning_message,
    dm_message: row.dm_message,
    log_message: row.log_message,
  };
}

export async function setHoneypotMessages(guild_id: string, messages: { warning_message?: string | null; dm_message?: string | null; log_message?: string | null; }) {
  if (messages.warning_message === null && messages.dm_message === null && messages.log_message === null) {
    await db`DELETE FROM honeypot_messages WHERE guild_id = ${guild_id}`;
    return;
  }
  await db`
    INSERT INTO honeypot_messages (guild_id, warning_message, dm_message, log_message)
    VALUES (${guild_id}, ${messages.warning_message}, ${messages.dm_message}, ${messages.log_message})
    ON CONFLICT(guild_id) DO UPDATE SET
      warning_message=excluded.warning_message,
      dm_message=excluded.dm_message,
      log_message=excluded.log_message
  `;
}


export async function getReinvite(guild_id: string): Promise<string | null> {
  const [row] = await db`SELECT invite FROM honeypot_reinvite WHERE guild_id = ${guild_id}`;
  if (!row) return null;
  return row.invite;
}

export async function setReinvite(guild_id: string, invite: string | false) {
  if (!invite) {
    await db`DELETE FROM honeypot_reinvite WHERE guild_id = ${guild_id}`;
    return;
  }
  await db`
    INSERT INTO honeypot_reinvite (guild_id, invite)
    VALUES (${guild_id}, ${invite})
    ON CONFLICT(guild_id) DO UPDATE SET
      invite=excluded.invite
  `;
}


export async function getFullStats(): Promise<{
  guilds: number;
  moderations: number;
  last7dModerations: number;
  last7dEngagedGuilds: number;
  dailyStats: { date: string; moderations: number; engagedGuilds: number; }[];
}> {
  const now = new Date();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(now.getUTCDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().replace('T', ' ').substring(0, "YYYY-MM-DD HH:mm:ss".length);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setUTCDate(now.getUTCDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().substring(0, "YYYY-MM-DD".length) + ' 00:00:00';

  const todayStartStr = now.toISOString().substring(0, "YYYY-MM-DD".length) + ' 00:00:00';

  const [[meta], events] = await Promise.all([
    db`
      SELECT
        (SELECT COUNT(*) FROM honeypot_config) AS guilds,
        (SELECT COUNT(*) FROM honeypot_events) AS moderations
    `,
    db`
      SELECT timestamp, guild_id
      FROM honeypot_events
      WHERE timestamp >= ${fourteenDaysAgoStr}
      ORDER BY timestamp ASC;
    `,
  ]);

  let last7dModerations = 0;
  const last7dGuilds = new Set<string>();
  const dailyMap = new Map<string, { moderations: number; guilds: Set<string> }>();

  for (const row of events) {
    const ts = row.timestamp;
    // skip events older than 14 days since they are irrelevant too old
    if (ts < fourteenDaysAgoStr) continue;

    const gID = row.guild_id?.toString() ?? null;

    if (ts >= sevenDaysAgoStr) {
      last7dModerations++;
      if (gID) last7dGuilds.add(gID);
    }

    // skip todays events for daily stats since the day isnt over yet
    if (ts >= todayStartStr) continue;

    const date = ts.slice(0, "YYYY-MM-DD".length);

    let day = dailyMap.get(date);
    if (!day) {
      day = { moderations: 0, guilds: new Set() };
      dailyMap.set(date, day);
    }

    day.moderations++;
    if (gID) day.guilds.add(gID);
  }

  return {
    guilds: meta.guilds,
    moderations: meta.moderations,
    last7dModerations,
    last7dEngagedGuilds: last7dGuilds.size,
    dailyStats: Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        moderations: v.moderations,
        engagedGuilds: v.guilds.size,
      })),
  };
}
