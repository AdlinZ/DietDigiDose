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
  {
    version: 11,
    name: "community_user_follows",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_follows (
          follower_id INTEGER NOT NULL,
          following_id INTEGER NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (follower_id, following_id),
          CHECK (follower_id != following_id),
          FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_follows_follower_created
          ON user_follows(follower_id, created_at DESC);
      `);
    },
  },
  {
    version: 12,
    name: "health_profile_safety_and_constraints",
    up(database) {
      for (const [column, definition] of [
        ["allergies_json", "TEXT DEFAULT '[]'"],
        ["medications", "TEXT DEFAULT ''"],
        ["medical_conditions_json", "TEXT DEFAULT '[]'"],
        ["medical_notes", "TEXT DEFAULT ''"],
        ["dietary_restrictions_json", "TEXT DEFAULT '[]'"],
        ["disliked_foods", "TEXT DEFAULT ''"],
        ["kitchen_constraints_json", "TEXT DEFAULT '{}'"],
        ["nutrition_targets_json", "TEXT DEFAULT '{}'"],
        ["tracking_enabled", "INTEGER DEFAULT 0"],
      ] as const) addColumn(database, "user_health_profiles", column, definition);
    },
  },
  {
    version: 13,
    name: "optional_glucose_and_cycle_tracking",
    up(database) {
      addColumn(database, "health_logs", "blood_glucose_mmol", "REAL");
      addColumn(database, "health_logs", "cycle_status", "TEXT");
    },
  },
  {
    version: 14,
    name: "user_level_adjustments",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_level_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          admin_user_id INTEGER,
          xp_delta INTEGER NOT NULL CHECK (xp_delta != 0),
          reason TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_user_level_adjustments_user_created
          ON user_level_adjustments(user_id, created_at DESC);
      `);
    },
  },
  {
    version: 15,
    name: "user_level_adjustment_admin_retention",
    up(database) {
      // 开发期间可能已经应用过 v14。重建表，既保留经验修正记录，
      // 又允许被降级的原管理员按普通用户流程注销账号。
      database.exec(`
        CREATE TABLE user_level_adjustments_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          admin_user_id INTEGER,
          xp_delta INTEGER NOT NULL CHECK (xp_delta != 0),
          reason TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO user_level_adjustments_next (id, user_id, admin_user_id, xp_delta, reason, created_at)
        SELECT id, user_id, admin_user_id, xp_delta, reason, created_at
        FROM user_level_adjustments;
        DROP TABLE user_level_adjustments;
        ALTER TABLE user_level_adjustments_next RENAME TO user_level_adjustments;
        CREATE INDEX idx_user_level_adjustments_user_created
          ON user_level_adjustments(user_id, created_at DESC);
      `);
    },
  },
  {
    version: 16,
    name: "custom_food_review_status",
    up(database) {
      addColumn(database, "user_custom_foods", "status", "TEXT NOT NULL DEFAULT 'pending'");
      database.exec(`
        UPDATE user_custom_foods SET status = 'pending' WHERE status IS NULL OR status = '';
        CREATE INDEX IF NOT EXISTS idx_user_custom_foods_status_created
          ON user_custom_foods(status, created_at DESC);
      `);
    },
  },
  {
    version: 17,
    name: "privacy_safe_public_names",
    up(database) {
      database.exec(`
        UPDATE users
        SET nickname = '食友' || id
        WHERE role != 'admin' AND (nickname IS NULL OR TRIM(nickname) = '');

        UPDATE community_posts
        SET nickname = COALESCE((SELECT nickname FROM users WHERE users.id = community_posts.user_id), '食友' || user_id),
            username = COALESCE((SELECT nickname FROM users WHERE users.id = community_posts.user_id), '食友' || user_id);

        UPDATE community_comments
        SET nickname = COALESCE((SELECT nickname FROM users WHERE users.id = community_comments.user_id), '食友' || user_id),
            username = COALESCE((SELECT nickname FROM users WHERE users.id = community_comments.user_id), '食友' || user_id);
      `);
    },
  },
  {
    version: 18,
    name: "idempotent_cooking_completions",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS cooking_completions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          recipe_id INTEGER,
          diet_record_id INTEGER NOT NULL,
          consumed_inventory_ids_json TEXT NOT NULL DEFAULT '[]',
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (diet_record_id) REFERENCES diet_records(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cooking_completions_user_created
          ON cooking_completions(user_id, created_at DESC);
      `);
    },
  },
  {
    version: 19,
    name: "idempotent_shopping_inventory_imports",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS shopping_inventory_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 20,
    name: "shared_rate_limit_buckets",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit_buckets (
          bucket_key TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL DEFAULT 0,
          window_started_at INTEGER NOT NULL,
          blocked_until INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated
          ON rate_limit_buckets(updated_at);
      `);
    },
  },
  {
    version: 21,
    name: "privacy_safe_funnel_events",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS funnel_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_name TEXT NOT NULL,
          actor_hash TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_funnel_events_name_created
          ON funnel_events(event_name, created_at DESC);
      `);
    },
  },
  {
    version: 22,
    name: "username_is_public_identity",
    up(database) {
      const users = database.prepare(
        "SELECT id, username, nickname, role FROM users ORDER BY id"
      ).all() as Array<{ id: number; username: string; nickname: string | null; role: string }>;
      const regularUsers = users.filter((user) => user.role !== "admin");
      const reservedNames = new Set(
        users.filter((user) => user.role === "admin").map((user) => user.username.toLocaleLowerCase())
      );

      const parkUsername = database.prepare("UPDATE users SET username = ? WHERE id = ?");
      for (const user of regularUsers) parkUsername.run(`__user_${user.id}__`, user.id);

      const updateUser = database.prepare("UPDATE users SET username = ?, nickname = ? WHERE id = ?");
      for (const user of regularUsers) {
        const preferred = String(user.nickname || "").trim() || `食友${user.id}`;
        let username = preferred.slice(0, 30);
        let suffixNumber = 0;
        while (reservedNames.has(username.toLocaleLowerCase())) {
          suffixNumber += 1;
          const suffix = `-${user.id}${suffixNumber > 1 ? `-${suffixNumber}` : ""}`;
          username = `${preferred.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
        }
        reservedNames.add(username.toLocaleLowerCase());
        // nickname 仅保留旧 username 作为种子数据兼容键；业务接口不再读写或返回它。
        updateUser.run(username, user.username, user.id);
      }

      database.exec(`
        UPDATE community_posts
        SET username = COALESCE((SELECT username FROM users WHERE users.id = community_posts.user_id), '食友' || user_id),
            nickname = NULL;
        UPDATE community_comments
        SET username = COALESCE((SELECT username FROM users WHERE users.id = community_comments.user_id), '食友' || user_id),
            nickname = NULL;
      `);
    },
  },
  {
    version: 23,
    name: "notification_center_v2",
    up(database) {
      for (const [column, definition] of [
        ["breakfast_time", "TEXT NOT NULL DEFAULT '08:00'"],
        ["lunch_time", "TEXT NOT NULL DEFAULT '12:00'"],
        ["dinner_time", "TEXT NOT NULL DEFAULT '18:00'"],
        ["water_start_time", "TEXT NOT NULL DEFAULT '10:00'"],
        ["water_end_time", "TEXT NOT NULL DEFAULT '18:00'"],
        ["water_interval_minutes", "INTEGER NOT NULL DEFAULT 120"],
        ["quiet_start_time", "TEXT NOT NULL DEFAULT '22:00'"],
        ["quiet_end_time", "TEXT NOT NULL DEFAULT '07:00'"],
        ["weekdays_enabled", "INTEGER NOT NULL DEFAULT 1"],
        ["weekends_enabled", "INTEGER NOT NULL DEFAULT 1"],
      ] as const) addColumn(database, "user_notification_preferences", column, definition);

      for (const [column, definition] of [
        ["category", "TEXT NOT NULL DEFAULT 'action_required'"],
        ["priority", "TEXT NOT NULL DEFAULT 'normal'"],
        ["action_status", "TEXT NOT NULL DEFAULT 'pending'"],
        ["group_key", "TEXT"],
        ["read_at", "DATETIME"],
        ["snoozed_until", "DATETIME"],
        ["updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ] as const) addColumn(database, "user_notification_inbox", column, definition);

      database.exec(`
        UPDATE user_notification_inbox
        SET category = CASE WHEN type = 'admin_campaign' THEN 'system' ELSE 'action_required' END,
            action_status = CASE WHEN type = 'admin_campaign' THEN 'info' ELSE 'pending' END,
            priority = CASE WHEN type = 'expiring_inventory' THEN 'high' ELSE 'normal' END;

        CREATE INDEX IF NOT EXISTS idx_user_notification_inbox_unread
          ON user_notification_inbox(user_id, is_read, id DESC);
        CREATE INDEX IF NOT EXISTS idx_user_notification_inbox_filter
          ON user_notification_inbox(user_id, category, action_status, id DESC);

        CREATE TABLE IF NOT EXISTS notification_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          notification_id INTEGER,
          event_type TEXT NOT NULL,
          metadata_json TEXT,
          expo_ticket_id TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (notification_id) REFERENCES user_notification_inbox(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notification_events_notification_created
          ON notification_events(notification_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notification_events_ticket
          ON notification_events(expo_ticket_id);

        CREATE TABLE IF NOT EXISTS push_notification_receipts (
          expo_ticket_id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          notification_id INTEGER,
          expo_push_token TEXT NOT NULL,
          submit_status TEXT NOT NULL,
          receipt_status TEXT NOT NULL DEFAULT 'pending',
          error_code TEXT,
          error_message TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          checked_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (notification_id) REFERENCES user_notification_inbox(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_push_receipts_pending
          ON push_notification_receipts(receipt_status, created_at);
      `);
    },
  },
  {
    version: 24,
    name: "notification_inventory_groups",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS notification_inventory_items (
          notification_id INTEGER NOT NULL,
          inventory_item_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (notification_id, inventory_item_id),
          FOREIGN KEY (notification_id) REFERENCES user_notification_inbox(id) ON DELETE CASCADE,
          FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notification_inventory_items_user
          ON notification_inventory_items(user_id, notification_id);
        INSERT OR IGNORE INTO notification_inventory_items (notification_id, inventory_item_id, user_id)
        SELECT id, inventory_item_id, user_id FROM user_notification_inbox
        WHERE inventory_item_id IS NOT NULL;
      `);
    },
  },
  {
    version: 25,
    name: "diet_record_actual_time",
    up(database) {
      addColumn(database, "diet_records", "recorded_time", "TEXT");
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_diet_records_user_date_time
          ON diet_records(user_id, recorded_at, recorded_time DESC, id DESC);
      `);
    },
  },
  {
    version: 26,
    name: "backfill_legacy_diet_record_times",
    up(database) {
      database.exec(`
        UPDATE diet_records
        SET recorded_time = CASE meal_type
          WHEN '早餐' THEN '08:00'
          WHEN '午餐' THEN '12:30'
          WHEN '晚餐' THEN '18:30'
          WHEN '加餐' THEN '15:30'
          ELSE NULL
        END
        WHERE recorded_time IS NULL AND meal_type IN ('早餐', '午餐', '晚餐', '加餐');
      `);
    },
  },
  {
    version: 27,
    name: "chat_message_roles_and_response_time",
    up(database) {
      // Rebuild the table so per-request system instructions can be audited as
      // their own role. Existing voice prompts are split out of the user text.
      addColumn(database, "ai_chat_messages", "response_time_ms", "INTEGER");
      database.exec(`
        CREATE TABLE ai_chat_messages_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
          content TEXT NOT NULL,
          response_time_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        INSERT INTO ai_chat_messages_next (user_id, session_id, role, content, response_time_ms, created_at)
        SELECT user_id, session_id, role, content, response_time_ms, created_at
        FROM (
          SELECT id AS source_id, 0 AS part_order, user_id, session_id,
                 'system' AS role,
                 '请用适合语音播报的精炼、亲切表达回答。' AS content,
                 NULL AS response_time_ms,
                 created_at
          FROM ai_chat_messages
          WHERE role = 'user'
            AND content LIKE '%' || char(10) || char(10) || '请用适合语音播报的精炼、亲切表达回答。'

          UNION ALL

          SELECT id AS source_id, 1 AS part_order, user_id, session_id, role,
                 CASE
                   WHEN role = 'user'
                    AND content LIKE '%' || char(10) || char(10) || '请用适合语音播报的精炼、亲切表达回答。'
                   THEN substr(content, 1, length(content) - length(char(10) || char(10) || '请用适合语音播报的精炼、亲切表达回答。'))
                   ELSE content
                 END AS content,
                 NULL AS response_time_ms,
                 created_at
          FROM ai_chat_messages
        ) migrated_messages
        ORDER BY source_id, part_order;

        DROP TABLE ai_chat_messages;
        ALTER TABLE ai_chat_messages_next RENAME TO ai_chat_messages;
        CREATE INDEX idx_ai_chat_messages_session
          ON ai_chat_messages(user_id, session_id, created_at);
        CREATE INDEX idx_ai_chat_messages_created_at
          ON ai_chat_messages(created_at DESC);
      `);
    },
  },
  {
    version: 28,
    name: "unified_chat_message_content",
    up(database) {
      addColumn(database, "ai_chat_messages", "source", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumn(database, "ai_chat_messages", "status", "TEXT NOT NULL DEFAULT 'completed'");
      addColumn(database, "ai_chat_messages", "payload_json", "TEXT");
      addColumn(database, "ai_chat_messages", "confirmation_id", "TEXT");

      const legacyCardMessages = database.prepare(`
        SELECT id, content FROM ai_chat_messages
        WHERE role = 'assistant' AND content LIKE '%【界面卡片上下文】%'
      `).all() as Array<{ id: number; content: string }>;
      const updateLegacyCard = database.prepare(`
        UPDATE ai_chat_messages SET content = ?, payload_json = ? WHERE id = ?
      `);
      for (const message of legacyCardMessages) {
        const [content, ...legacyCardSummaries] = message.content.split("\n\n【界面卡片上下文】\n");
        updateLegacyCard.run(
          content,
          JSON.stringify({ legacyCardSummaries: legacyCardSummaries.filter(Boolean) }),
          message.id,
        );
      }

      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_source_created
          ON ai_chat_messages(source, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_confirmation
          ON ai_chat_messages(confirmation_id)
          WHERE confirmation_id IS NOT NULL;
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
