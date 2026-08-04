import type Database from "better-sqlite3";

type Migration = {
  version: number;
  name: string;
  up: (database: Database.Database) => void;
};

function addColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "legacy_auth_and_community_fields",
    up(database) {
      addColumn(database, "users", "email", "TEXT");
      addColumn(database, "users", "phone", "TEXT");
      addColumn(database, "users", "role", "TEXT DEFAULT 'user'");
      addColumn(database, "users", "must_change_password", "INTEGER DEFAULT 0");
      addColumn(database, "users", "last_login_at", "DATETIME");
      addColumn(database, "users", "last_login_ip", "TEXT");
      addColumn(database, "users", "is_verified_expert", "INTEGER DEFAULT 0");
      addColumn(database, "community_posts", "category", "TEXT DEFAULT '寻味'");
      addColumn(database, "community_posts", "views_count", "INTEGER DEFAULT 0");
      addColumn(database, "community_posts", "comment_count", "INTEGER DEFAULT 0");
      addColumn(database, "community_posts", "image_urls", "TEXT");
      addColumn(database, "community_posts", "event_start_at", "DATETIME");
      addColumn(database, "community_posts", "event_end_at", "DATETIME");
      addColumn(database, "community_posts", "question_status", "TEXT DEFAULT 'open'");
      addColumn(database, "community_posts", "accepted_comment_id", "INTEGER");
      addColumn(database, "community_comments", "image_url", "TEXT");
    },
  },
  {
    version: 2,
    name: "moderation_and_import_metadata",
    up(database) {
      addColumn(database, "community_posts", "deleted_at", "DATETIME");
      addColumn(database, "community_posts", "deleted_by", "INTEGER");
      for (const [column, definition] of [
        ["deleted_at", "DATETIME"], ["deleted_by", "INTEGER"], ["author_user_id", "INTEGER"],
        ["source", "TEXT DEFAULT 'official'"], ["status", "TEXT DEFAULT 'approved'"],
        ["reviewed_by", "INTEGER"], ["reviewed_at", "DATETIME"], ["reject_reason", "TEXT"],
        ["external_id", "TEXT"], ["source_url", "TEXT"], ["data_license", "TEXT"],
        ["source_revision", "TEXT"], ["source_attribution", "TEXT"], ["nutrition_json", "TEXT"],
        ["updated_at", "DATETIME"],
      ] as const) addColumn(database, "recipes", column, definition);
      for (const [column, definition] of [
        ["deleted_at", "DATETIME"], ["deleted_by", "INTEGER"], ["barcode", "TEXT"],
        ["brands", "TEXT"], ["micronutrients_json", "TEXT"], ["data_license", "TEXT"],
        ["original_name", "TEXT"],
      ] as const) addColumn(database, "ingredients_library", column, definition);
    },
  },
  {
    version: 3,
    name: "health_profile_goals",
    up(database) {
      addColumn(database, "user_health_profiles", "health_goal", "TEXT DEFAULT 'healthy'");
      addColumn(database, "user_health_profiles", "activity_level", "TEXT DEFAULT 'moderate'");
      addColumn(database, "user_health_profiles", "dietary_preference", "TEXT DEFAULT '无特别偏好'");
    },
  },
  {
    version: 4,
    name: "ai_cost_and_failure_reason",
    up(database) {
      addColumn(database, "ai_usage_logs", "estimated_cost_usd", "REAL DEFAULT 0");
      addColumn(database, "ai_usage_logs", "failure_reason", "TEXT");
    },
  },
  {
    version: 5,
    name: "extended_health_metrics",
    up(database) {
      for (const [column, definition] of [
        ["height_cm", "REAL"], ["waist_cm", "REAL"], ["hip_cm", "REAL"],
        ["resting_heart_rate", "INTEGER"], ["blood_pressure_systolic", "INTEGER"],
        ["blood_pressure_diastolic", "INTEGER"], ["sleep_hours", "REAL"],
      ] as const) addColumn(database, "health_logs", column, definition);
    },
  },
  {
    version: 6,
    name: "ai_write_confirmations",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS ai_write_confirmations (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          conversation_id TEXT,
          source_message_id TEXT,
          action TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview', 'committed', 'expired', 'cancelled')),
          idempotency_key TEXT,
          committed_result_json TEXT,
          expires_at DATETIME NOT NULL,
          committed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_write_confirmations_user_idempotency
          ON ai_write_confirmations(user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_ai_write_confirmations_user_status
          ON ai_write_confirmations(user_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS ai_write_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          confirmation_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          event TEXT NOT NULL,
          details_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (confirmation_id) REFERENCES ai_write_confirmations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 7,
    name: "user_disable_status",
    up(database) {
      addColumn(database, "users", "is_disabled", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 8,
    name: "push_notifications",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_notification_preferences (
          user_id INTEGER PRIMARY KEY,
          expiring_alert INTEGER NOT NULL DEFAULT 1,
          meal_reminder INTEGER NOT NULL DEFAULT 1,
          water_reminder INTEGER NOT NULL DEFAULT 1,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS push_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          expo_push_token TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_push_devices_user_active
          ON push_devices(user_id, is_active);
        CREATE TABLE IF NOT EXISTS notification_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          inventory_item_id INTEGER,
          notification_type TEXT NOT NULL,
          delivery_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, inventory_item_id, notification_type, delivery_date),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 9,
    name: "notification_campaigns",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS notification_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'sending',
          recipient_count INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          sent_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS notification_campaign_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          push_device_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          error_code TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (campaign_id) REFERENCES notification_campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (push_device_id) REFERENCES push_devices(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created
          ON notification_campaigns(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notification_deliveries_campaign
          ON notification_campaign_deliveries(campaign_id, status);
      `);
    },
  },
  {
    version: 10,
    name: "in_app_notification_inbox",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_notification_inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          campaign_id INTEGER,
          inventory_item_id INTEGER,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (campaign_id) REFERENCES notification_campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
          UNIQUE(user_id, campaign_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_notification_inbox_user_created
          ON user_notification_inbox(user_id, created_at DESC);
        INSERT OR IGNORE INTO user_notification_inbox (user_id, type, title, body, campaign_id, created_at)
        SELECT u.id, 'admin_campaign', c.title, c.body, c.id, c.created_at
        FROM notification_campaigns c
        JOIN users u ON u.role != 'admin' AND COALESCE(u.is_disabled, 0) = 0;
      `);
    },
  },
];

export function runMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const applied = new Set(
    (database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>)
      .map((row) => row.version),
  );
  const record = database.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      migration.up(database);
      record.run(migration.version, migration.name);
    })();
  }
}
