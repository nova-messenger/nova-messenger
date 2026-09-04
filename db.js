const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || 'file:./nova.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({
  url,
  authToken
});

async function initDb() {
  const schemaQueries = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT DEFAULT 'Disponibile su NOVA.',
      is_verified INTEGER DEFAULT 0,
      verification_code TEXT,
      verification_expires INTEGER,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      is_group INTEGER DEFAULT 0,
      name TEXT,
      icon_url TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT,
      media_type TEXT DEFAULT 'text',
      media_url TEXT,
      reply_to_id TEXT,
      is_deleted INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      edited_at INTEGER,
      is_pinned INTEGER DEFAULT 0,
      pinned_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS starred_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, message_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      media_url TEXT,
      text_content TEXT,
      bg_gradient TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS community_members (
      community_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(community_id, user_id),
      FOREIGN KEY(community_id) REFERENCES communities(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      caller_id TEXT NOT NULL,
      receiver_id TEXT,
      conversation_id TEXT,
      call_type TEXT DEFAULT 'video',
      status TEXT DEFAULT 'completed',
      duration INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_starred_user ON starred_messages(user_id);`
  ];

  for (const query of schemaQueries) {
    await db.execute(query);
  }

  const migrations = [
    'ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0;',
    'ALTER TABLE messages ADD COLUMN edited_at INTEGER;',
    'ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0;',
    'ALTER TABLE messages ADD COLUMN pinned_at INTEGER;',
    'ALTER TABLE sessions ADD COLUMN user_agent TEXT;',
    'ALTER TABLE sessions ADD COLUMN ip_address TEXT;',
    'ALTER TABLE sessions ADD COLUMN last_active INTEGER;'
  ];

  for (const migration of migrations) {
    try {
      await db.execute(migration);
    } catch (e) {
      // Ignore errors for existing columns
    }
  }

  console.log('[Database] NOVA Turso/LibSQL database initialized successfully at', url);
}

module.exports = {
  db,
  initDb,
  async run(query, params = []) {
    return await db.execute({ sql: query, args: params });
  },
  async get(query, params = []) {
    const result = await db.execute({ sql: query, args: params });
    return result.rows.length > 0 ? result.rows[0] : null;
  },
  async all(query, params = []) {
    const result = await db.execute({ sql: query, args: params });
    return result.rows;
  }
};
