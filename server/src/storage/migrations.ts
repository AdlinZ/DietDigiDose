import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { describeHistoricalStoredMediaUrls } from "../services/mediaStorage.js";
import { assessRecipeQuality } from "../services/recipeQuality.js";

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
  {
    version: 29,
    name: "recipe_quality_gate",
    up(database) {
      addColumn(database, "recipes", "quality_status", "TEXT NOT NULL DEFAULT 'trusted'");
      addColumn(database, "recipes", "nutrition_basis", "TEXT NOT NULL DEFAULT 'source'");
      addColumn(database, "recipes", "quality_issues_json", "TEXT NOT NULL DEFAULT '[]'");
      addColumn(database, "recipes", "quality_reviewed_by", "INTEGER");
      addColumn(database, "recipes", "quality_reviewed_at", "DATETIME");
      addColumn(database, "recipes", "quality_review_reason", "TEXT");

      const recipes = database.prepare(`
        SELECT id, source, cook_time, calories, protein, carbs, fat, ingredients_json, steps_json
        FROM recipes
      `).all() as Array<{
        id: number;
        source: string;
        cook_time: number;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        ingredients_json: string | null;
        steps_json: string | null;
      }>;
      const update = database.prepare(`
        UPDATE recipes
        SET quality_status = ?, nutrition_basis = ?, quality_issues_json = ?
        WHERE id = ?
      `);
      for (const recipe of recipes) {
        let ingredients: unknown[] = [];
        let steps: unknown[] = [];
        try { ingredients = JSON.parse(recipe.ingredients_json || "[]"); } catch { ingredients = []; }
        try { steps = JSON.parse(recipe.steps_json || "[]"); } catch { steps = []; }
        const assessment = assessRecipeQuality({
          source: recipe.source || "official",
          cookTime: Number(recipe.cook_time),
          calories: Number(recipe.calories),
          protein: Number(recipe.protein),
          carbs: Number(recipe.carbs),
          fat: Number(recipe.fat),
          ingredients: ingredients as Array<{ name?: string; amount?: string } | string>,
          steps,
        });
        update.run(
          assessment.qualityStatus,
          assessment.nutritionBasis,
          JSON.stringify(assessment.issues),
          recipe.id,
        );
      }

      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_recipes_public_quality
          ON recipes(status, quality_status, id DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_recipes_quality_review
          ON recipes(quality_status, source, id DESC) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 30,
    name: "supervisor_agent_runtime",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          modality TEXT NOT NULL CHECK(modality IN ('text', 'home', 'cooking', 'image', 'audio', 'inventory_scan', 'receipt')),
          source TEXT NOT NULL DEFAULT 'assistant',
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'awaiting_input', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'expired')),
          input_json TEXT NOT NULL,
          result_json TEXT,
          pending_approval_json TEXT,
          error_code TEXT,
          error_message TEXT,
          checkpoint_thread_id TEXT NOT NULL,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
          ON agent_runs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated
          ON agent_runs(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session
          ON agent_runs(user_id, session_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_run_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          agent_name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_sequence
          ON agent_run_events(run_id, sequence);

        CREATE TABLE IF NOT EXISTS agent_actions (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'high', 'forbidden')),
          status TEXT NOT NULL CHECK(status IN ('proposed', 'awaiting_approval', 'executed', 'rejected', 'undone', 'failed', 'expired')),
          payload_json TEXT NOT NULL,
          before_json TEXT,
          result_json TEXT,
          idempotency_key TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          expires_at DATETIME,
          executed_at DATETIME,
          undone_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_actions_run_status
          ON agent_actions(run_id, status);

        CREATE TABLE IF NOT EXISTS meal_plans (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'cancelled')),
          source TEXT NOT NULL DEFAULT 'agent',
          constraints_json TEXT NOT NULL DEFAULT '{}',
          created_by_run_id TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_meal_plans_user_dates
          ON meal_plans(user_id, start_date, end_date);

        CREATE TABLE IF NOT EXISTS meal_plan_items (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          planned_date TEXT NOT NULL,
          meal_type TEXT NOT NULL,
          title TEXT NOT NULL,
          recipe_id INTEGER,
          ingredients_json TEXT NOT NULL DEFAULT '[]',
          steps_json TEXT NOT NULL DEFAULT '[]',
          calories REAL,
          protein REAL,
          carbs REAL,
          fat REAL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (plan_id) REFERENCES meal_plans(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_meal_plan_items_user_date
          ON meal_plan_items(user_id, planned_date, meal_type);

        CREATE TABLE IF NOT EXISTS shopping_list_items (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          client_id TEXT,
          name TEXT NOT NULL,
          amount TEXT NOT NULL DEFAULT '适量',
          category TEXT NOT NULL DEFAULT '其他',
          checked INTEGER NOT NULL DEFAULT 0,
          purchase_date TEXT,
          storage_location TEXT,
          source_run_id TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (source_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_items_user_client
          ON shopping_list_items(user_id, client_id) WHERE client_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_shopping_items_user_active
          ON shopping_list_items(user_id, checked, updated_at DESC) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 31,
    name: "agent_media_and_approval_audit",
    up(database) {
      addColumn(database, "agent_actions", "approval_decision", "TEXT");
      addColumn(database, "agent_actions", "approved_by_user_id", "INTEGER");
      addColumn(database, "agent_actions", "approved_at", "DATETIME");
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_run_media (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('image', 'audio')),
          mime_type TEXT,
          data_base64 TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_run_media_run ON agent_run_media(run_id);
      `);
    },
  },
  {
    version: 32,
    name: "agent_supplemental_input",
    up(database) {
      addColumn(database, "agent_runs", "pending_input_json", "TEXT");
    },
  },
  {
    version: 33,
    name: "agent_run_token_usage_attribution",
    up(database) {
      addColumn(database, "ai_usage_logs", "run_id", "TEXT");
      addColumn(database, "ai_usage_logs", "agent_name", "TEXT");
      addColumn(database, "ai_usage_logs", "phase", "TEXT");
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_run_agent
          ON ai_usage_logs(run_id, agent_name, created_at);
      `);
    },
  },
  {
    version: 34,
    name: "agent_undo_versions_and_chat_deletions",
    up(database) {
      addColumn(database, "meal_plans", "version", "INTEGER NOT NULL DEFAULT 1");
      database.exec(`
        CREATE TABLE IF NOT EXISTS ai_chat_session_deletions (
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          deleted_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
          PRIMARY KEY (user_id, session_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_chat_session_deletions_time
          ON ai_chat_session_deletions(deleted_at);
      `);
    },
  },
  {
    version: 35,
    name: "authentication_verification_center",
    up(database) {
      addColumn(database, "users", "phone_verified_at", "DATETIME");
      database.exec(`
        CREATE TABLE IF NOT EXISTS auth_verification_subjects (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
          channel TEXT NOT NULL CHECK(channel IN ('sms', 'captcha', 'phone')),
          provider TEXT NOT NULL, subject_hmac TEXT NOT NULL,
          subject_ciphertext TEXT NOT NULL, subject_iv TEXT NOT NULL,
          subject_auth_tag TEXT NOT NULL, last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(channel, provider, subject_hmac),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS auth_verification_challenges (
          id TEXT PRIMARY KEY, subject_id INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT 'login',
          out_id TEXT NOT NULL UNIQUE, biz_id TEXT, provider_request_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
          registration_token_hash TEXT, registration_expires_at DATETIME, expires_at DATETIME NOT NULL,
          verified_at DATETIME, consumed_at DATETIME, source_ip TEXT, user_agent TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (subject_id) REFERENCES auth_verification_subjects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS auth_verification_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, challenge_id TEXT,
          channel TEXT NOT NULL, provider TEXT NOT NULL, event_type TEXT NOT NULL, outcome TEXT NOT NULL,
          provider_code TEXT, provider_message TEXT, provider_request_id TEXT, biz_id TEXT, out_id TEXT,
          source_ip TEXT, user_agent TEXT, details_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (subject_id) REFERENCES auth_verification_subjects(id) ON DELETE CASCADE,
          FOREIGN KEY (challenge_id) REFERENCES auth_verification_challenges(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS auth_verification_usage_daily (
          usage_date TEXT NOT NULL, channel TEXT NOT NULL, provider TEXT NOT NULL,
          send_requests INTEGER NOT NULL DEFAULT 0, send_api_calls INTEGER NOT NULL DEFAULT 0,
          accepted INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
          delivery_failed INTEGER NOT NULL DEFAULT 0, verify_api_calls INTEGER NOT NULL DEFAULT 0,
          verify_passed INTEGER NOT NULL DEFAULT 0, verify_failed INTEGER NOT NULL DEFAULT 0,
          local_rate_limited INTEGER NOT NULL DEFAULT 0, provider_errors INTEGER NOT NULL DEFAULT 0,
          delivery_units INTEGER NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (usage_date, channel, provider)
        );
        CREATE INDEX IF NOT EXISTS idx_auth_subjects_user ON auth_verification_subjects(user_id, channel);
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_subject_created ON auth_verification_challenges(subject_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_biz_out ON auth_verification_challenges(biz_id, out_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_challenges_registration_token ON auth_verification_challenges(registration_token_hash) WHERE registration_token_hash IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_auth_events_subject_created ON auth_verification_events(subject_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_events_ip_created ON auth_verification_events(source_ip, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_events_provider_ids ON auth_verification_events(biz_id, out_id, provider_request_id);
      `);
    },
  },
  {
    version: 36,
    name: "daily_user_check_ins",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_daily_check_ins (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
          check_in_date TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, check_in_date), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_daily_check_ins_user_date ON user_daily_check_ins(user_id, check_in_date DESC);
      `);
    },
  },
  {
    version: 37,
    name: "community_post_ip_location",
    up(database) { addColumn(database, "community_posts", "ip_location", "TEXT"); },
  },
  {
    version: 38,
    name: "community_share_codes",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS community_share_codes (
          code TEXT PRIMARY KEY, post_id INTEGER NOT NULL, created_by INTEGER,
          expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_community_share_codes_post ON community_share_codes(post_id, expires_at DESC);
      `);
    },
  },
  {
    version: 39,
    name: "user_session_version",
    up(database) {
      addColumn(database, "users", "session_version", "INTEGER NOT NULL DEFAULT 1");
      database.exec("UPDATE users SET session_version = 1 WHERE session_version IS NULL OR session_version < 1");
    },
  },
  {
    version: 40,
    name: "repair_public_usernames_from_login_identifiers",
    up(database) {
      const affected = database.prepare(`
        SELECT id FROM users
        WHERE role != 'admin'
          AND ((email IS NOT NULL AND LOWER(username) = LOWER(email)) OR (phone IS NOT NULL AND username = phone))
        ORDER BY id
      `).all() as Array<{ id: number }>;
      if (!affected.length) return;
      const park = database.prepare("UPDATE users SET username = ? WHERE id = ?");
      for (const user of affected) park.run(`__repair_user_${user.id}__`, user.id);
      const reserved = new Set(
        (database.prepare("SELECT LOWER(username) AS username FROM users").all() as Array<{ username: string }>)
          .map((row) => row.username),
      );
      const update = database.prepare("UPDATE users SET username = ? WHERE id = ?");
      for (const user of affected) {
        let candidate = `食友${user.id}`;
        let suffix = 1;
        while (reserved.has(candidate.toLocaleLowerCase())) {
          suffix += 1;
          candidate = `食友${user.id}-${suffix}`;
        }
        reserved.add(candidate.toLocaleLowerCase());
        update.run(candidate, user.id);
      }
      database.exec(`
        UPDATE community_posts
        SET username = COALESCE((SELECT username FROM users WHERE users.id = community_posts.user_id), '食友' || user_id)
        WHERE user_id IN (
          SELECT id FROM users
          WHERE role != 'admin' AND username LIKE '食友%'
        );
        UPDATE community_comments
        SET username = COALESCE((SELECT username FROM users WHERE users.id = community_comments.user_id), '食友' || user_id)
        WHERE user_id IN (
          SELECT id FROM users
          WHERE role != 'admin' AND username LIKE '食友%'
        );
      `);
    },
  },
  {
    version: 41,
    name: "community_feed_pagination_index",
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_community_posts_feed_page
        ON community_posts(deleted_at, created_at DESC, id DESC)
      `);
    },
  },
  {
    version: 42,
    name: "server_cooking_queue",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS cooking_queue_items (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          recipe_id INTEGER NOT NULL,
          position INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'waiting'
            CHECK(status IN ('waiting', 'preparing', 'ready', 'cooking', 'completed', 'cancelled')),
          meal_type TEXT
            CHECK(meal_type IS NULL OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
          planned_at DATETIME,
          recipe_snapshot_json TEXT NOT NULL DEFAULT '{}',
          prepared_ingredients_json TEXT NOT NULL DEFAULT '[]',
          shopping_list_synced_at DATETIME,
          idempotency_key TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          completed_at DATETIME,
          deleted_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cooking_queue_active_recipe
          ON cooking_queue_items(user_id, recipe_id)
          WHERE deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking');
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cooking_queue_idempotency
          ON cooking_queue_items(user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_cooking_queue_user_position
          ON cooking_queue_items(user_id, position, created_at)
          WHERE deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking');
        CREATE INDEX IF NOT EXISTS idx_cooking_queue_user_history
          ON cooking_queue_items(user_id, updated_at DESC);
      `);
    },
  },
  {
    version: 43,
    name: "community_linked_recipe",
    up(database) {
      addColumn(database, "community_posts", "linked_recipe_id", "INTEGER REFERENCES recipes(id) ON DELETE SET NULL");
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_community_posts_linked_recipe
          ON community_posts(linked_recipe_id)
          WHERE linked_recipe_id IS NOT NULL;
      `);
    },
  },
  {
    version: 44,
    name: "structured_inventory_quantities",
    up(database) {
      for (const [column, definition] of [
        ["quantity_value", "REAL"],
        ["quantity_unit", "TEXT"],
        ["package_size_value", "REAL"],
        ["package_size_unit", "TEXT"],
        ["batch_code", "TEXT"],
        ["version", "INTEGER NOT NULL DEFAULT 1"],
        ["deleted_at", "DATETIME"],
        ["updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ] as const) addColumn(database, "inventory_items", column, definition);
      database.exec(`
        CREATE TABLE IF NOT EXISTS inventory_consumption_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS inventory_change_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          inventory_item_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          source TEXT NOT NULL,
          quantity_before REAL,
          quantity_after REAL,
          quantity_unit TEXT,
          delta_value REAL,
          idempotency_key TEXT,
          metadata_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_batches_fefo
          ON inventory_items(user_id, food_name, is_available, expiration_date, id);
        CREATE INDEX IF NOT EXISTS idx_inventory_change_logs_item
          ON inventory_change_logs(user_id, inventory_item_id, created_at DESC);
      `);

      const aliases: Record<string, string> = {
        g: "g", "克": "g", kg: "kg", "千克": "kg", "公斤": "kg",
        ml: "ml", "毫升": "ml", l: "l", "升": "l",
        "个": "piece", "枚": "piece", "只": "piece", "片": "piece",
        "份": "serving", "袋": "bag", "盒": "box", "瓶": "bottle", "罐": "can",
      };
      const rows = database.prepare(`
        SELECT id, quantity FROM inventory_items
        WHERE quantity_value IS NULL AND quantity IS NOT NULL
      `).all() as Array<{ id: number; quantity: string }>;
      const update = database.prepare("UPDATE inventory_items SET quantity_value = ?, quantity_unit = ? WHERE id = ?");
      for (const row of rows) {
        const match = String(row.quantity).trim().match(/^(\d+(?:\.\d+)?)\s*([^\d\s]+)$/i);
        if (!match) continue;
        const unit = aliases[match[2].toLocaleLowerCase()] || aliases[match[2]];
        const value = Number(match[1]);
        if (unit && Number.isFinite(value) && value >= 0) update.run(value, unit, row.id);
      }
    },
  },
  {
    version: 45,
    name: "unified_inventory_intake_batches",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS inventory_intake_batches (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('barcode', 'receipt', 'image', 'manual', 'recent')),
          source_reference TEXT,
          confirmed_payload_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_intake_batches_user_created
          ON inventory_intake_batches(user_id, created_at DESC);
      `);
    },
  },
  {
    version: 46,
    name: "meal_plan_execution_workbench",
    up(database) {
      for (const [column, definition] of [
        ["version", "INTEGER NOT NULL DEFAULT 1"],
        ["status", "TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'queued', 'cooking', 'completed', 'skipped'))"],
        ["diet_record_id", "INTEGER REFERENCES diet_records(id) ON DELETE SET NULL"],
        ["queue_item_id", "TEXT REFERENCES cooking_queue_items(id) ON DELETE SET NULL"],
        ["completed_at", "DATETIME"],
        ["deleted_at", "DATETIME"],
      ] as const) addColumn(database, "meal_plan_items", column, definition);
      database.exec(`
        CREATE TABLE IF NOT EXISTS meal_plan_execution_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          action TEXT NOT NULL,
          meal_plan_item_id TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (meal_plan_item_id) REFERENCES meal_plan_items(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_meal_plan_items_execution
          ON meal_plan_items(user_id, planned_date, status)
          WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 47,
    name: "household_collaborative_shopping",
    up(database) {
      addColumn(database, "households", "version", "INTEGER NOT NULL DEFAULT 1");
      database.exec(`
        CREATE TABLE IF NOT EXISTS household_shopping_items (
          id TEXT PRIMARY KEY,
          household_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          amount TEXT NOT NULL DEFAULT '适量',
          category TEXT NOT NULL DEFAULT '其他',
          checked INTEGER NOT NULL DEFAULT 0,
          storage_location TEXT,
          expiration_date TEXT,
          created_by_user_id INTEGER NOT NULL,
          updated_by_user_id INTEGER NOT NULL,
          purchased_by_user_id INTEGER,
          version INTEGER NOT NULL DEFAULT 1,
          transferred_at DATETIME,
          intake_batch_id TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME,
          FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (purchased_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS household_shopping_intake_batches (
          id TEXT PRIMARY KEY,
          household_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(household_id, idempotency_key),
          FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_household_shopping_active
          ON household_shopping_items(household_id, checked, updated_at DESC)
          WHERE deleted_at IS NULL AND transferred_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_household_shopping_name
          ON household_shopping_items(household_id, name)
          WHERE deleted_at IS NULL AND transferred_at IS NULL;
      `);
    },
  },
  {
    version: 48,
    name: "traceable_inventory_outcomes",
    up(database) {
      addColumn(database, "household_inventory_items", "version", "INTEGER NOT NULL DEFAULT 1");
      addColumn(database, "household_inventory_items", "updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
      database.exec(`
        CREATE TABLE IF NOT EXISTS inventory_outcome_events (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK(scope IN ('personal', 'household')),
          user_id INTEGER,
          household_id INTEGER,
          inventory_item_id INTEGER,
          household_inventory_item_id INTEGER,
          outcome TEXT NOT NULL CHECK(outcome IN ('cooked', 'used', 'discarded', 'expired', 'gifted', 'transferred', 'unknown')),
          source TEXT NOT NULL CHECK(source IN ('manual', 'cooking', 'reminder', 'recommendation', 'cleanup')),
          quantity_value REAL,
          quantity_unit TEXT,
          quantity_text TEXT,
          idempotency_key TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by_user_id INTEGER NOT NULL,
          updated_by_user_id INTEGER NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK((scope = 'personal' AND user_id IS NOT NULL AND inventory_item_id IS NOT NULL AND household_id IS NULL AND household_inventory_item_id IS NULL)
             OR (scope = 'household' AND household_id IS NOT NULL AND household_inventory_item_id IS NOT NULL AND user_id IS NULL AND inventory_item_id IS NULL)),
          UNIQUE(created_by_user_id, idempotency_key),
          UNIQUE(user_id, idempotency_key),
          UNIQUE(household_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
          FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
          FOREIGN KEY (household_inventory_item_id) REFERENCES household_inventory_items(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_outcomes_personal_week
          ON inventory_outcome_events(user_id, occurred_at) WHERE scope = 'personal';
        CREATE INDEX IF NOT EXISTS idx_inventory_outcomes_household_week
          ON inventory_outcome_events(household_id, occurred_at) WHERE scope = 'household';
      `);
    },
  },
  {
    version: 49,
    name: "unified_recipe_recommendations",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS recipe_recommendation_requests (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          surface TEXT NOT NULL,
          scoring_version TEXT NOT NULL,
          candidate_version TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          input_snapshot_json TEXT NOT NULL,
          results_json TEXT NOT NULL,
          data_updated_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recipe_recommendation_requests_user_created
          ON recipe_recommendation_requests(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS recipe_recommendation_events (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          request_id TEXT,
          recipe_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('exposure', 'view', 'favorite', 'skip', 'shopping', 'queue', 'start', 'complete', 'constraint_change')),
          scoring_version TEXT NOT NULL,
          surface TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          idempotency_key TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (request_id) REFERENCES recipe_recommendation_requests(id) ON DELETE SET NULL,
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recipe_recommendation_events_user_recipe
          ON recipe_recommendation_events(user_id, recipe_id, created_at DESC);
      `);
    },
  },
  {
    version: 50,
    name: "realtime_cooking_voice_sessions",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS realtime_voice_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          recipe_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'muted', 'closed', 'expired', 'fallback')),
          client_platform TEXT NOT NULL,
          context_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          expires_at DATETIME NOT NULL,
          first_transcript_ms INTEGER,
          first_response_ms INTEGER,
          interruption_count INTEGER NOT NULL DEFAULT 0,
          reconnect_count INTEGER NOT NULL DEFAULT 0,
          fallback_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(user_id, idempotency_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS realtime_voice_turns (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          transcript TEXT NOT NULL,
          intent TEXT NOT NULL,
          action_json TEXT NOT NULL DEFAULT '{}',
          agent_run_id TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, id),
          FOREIGN KEY (session_id) REFERENCES realtime_voice_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS realtime_voice_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, sequence),
          FOREIGN KEY (session_id) REFERENCES realtime_voice_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_realtime_voice_events_session_sequence
          ON realtime_voice_events(session_id, sequence);
      `);
    },
  },
  {
    version: 51,
    name: "content_governance_and_kitchenware_capabilities",
    up(database) {
      for (const [column, definition] of [
        ["normalized_name", "TEXT"],
        ["aliases_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["search_keywords", "TEXT NOT NULL DEFAULT ''"],
        ["preparation_state", "TEXT NOT NULL DEFAULT 'unspecified'"],
        ["quality_status", "TEXT NOT NULL DEFAULT 'trusted'"],
        ["source_version", "TEXT"],
        ["source_updated_at", "DATETIME"],
        ["nutrition_basis", "TEXT NOT NULL DEFAULT 'per_100g'"],
        ["edible_ratio", "REAL NOT NULL DEFAULT 1"],
        ["review_notes", "TEXT"],
      ] as const) addColumn(database, "ingredients_library", column, definition);

      for (const [column, definition] of [
        ["canonical_key", "TEXT"],
        ["source_content_hash", "TEXT"],
        ["import_batch_id", "TEXT"],
        ["serving_size", "INTEGER"],
        ["prep_time", "INTEGER"],
        ["cuisine", "TEXT"],
        ["meal_types_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["required_kitchenware_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["optional_kitchenware_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["duplicate_of_recipe_id", "INTEGER"],
        ["withdrawn_at", "DATETIME"],
      ] as const) addColumn(database, "recipes", column, definition);

      for (const [table, column, definition] of [
        ["kitchenware_catalog", "attributes_json", "TEXT NOT NULL DEFAULT '{}'"],
        ["kitchenware_catalog", "quality_status", "TEXT NOT NULL DEFAULT 'trusted'"],
        ["kitchenware_catalog", "capability_version", "INTEGER NOT NULL DEFAULT 1"],
        ["kitchenware_catalog", "updated_at", "DATETIME"],
        ["kitchenware_items", "catalog_id", "INTEGER"],
        ["kitchenware_items", "attributes_json", "TEXT NOT NULL DEFAULT '{}'"],
      ] as const) addColumn(database, table, column, definition);
      database.exec("UPDATE kitchenware_catalog SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)");

      database.exec(`
        CREATE TABLE IF NOT EXISTS ingredient_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient_id INTEGER NOT NULL,
          alias TEXT NOT NULL,
          normalized_alias TEXT NOT NULL,
          locale TEXT NOT NULL DEFAULT 'zh-CN',
          alias_type TEXT NOT NULL DEFAULT 'synonym',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(ingredient_id, normalized_alias),
          FOREIGN KEY (ingredient_id) REFERENCES ingredients_library(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ingredient_aliases_lookup
          ON ingredient_aliases(normalized_alias, ingredient_id);
        CREATE TABLE IF NOT EXISTS ingredient_portions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          grams REAL NOT NULL CHECK(grams > 0),
          source TEXT NOT NULL,
          source_version TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(ingredient_id, label),
          FOREIGN KEY (ingredient_id) REFERENCES ingredients_library(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ingredient_import_batches (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_version TEXT NOT NULL,
          data_license TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running', 'validated', 'committed', 'rolled_back', 'failed')),
          stats_json TEXT NOT NULL DEFAULT '{}',
          error_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          rolled_back_at DATETIME
        );
        CREATE TABLE IF NOT EXISTS ingredient_import_batch_items (
          batch_id TEXT NOT NULL,
          ingredient_id INTEGER NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('insert', 'update')),
          before_json TEXT,
          after_json TEXT NOT NULL,
          PRIMARY KEY (batch_id, ingredient_id),
          FOREIGN KEY (batch_id) REFERENCES ingredient_import_batches(id) ON DELETE CASCADE,
          FOREIGN KEY (ingredient_id) REFERENCES ingredients_library(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ingredient_search_gaps (
          normalized_query TEXT PRIMARY KEY,
          sample_query TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 1,
          first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recipe_import_batches (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_revision TEXT NOT NULL,
          data_license TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running', 'validated', 'committed', 'rolled_back', 'failed')),
          stats_json TEXT NOT NULL DEFAULT '{}',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          rolled_back_at DATETIME
        );
        CREATE TABLE IF NOT EXISTS recipe_import_batch_items (
          batch_id TEXT NOT NULL,
          recipe_id INTEGER NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('insert', 'update')),
          before_json TEXT,
          after_json TEXT NOT NULL,
          PRIMARY KEY (batch_id, recipe_id),
          FOREIGN KEY (batch_id) REFERENCES recipe_import_batches(id) ON DELETE CASCADE,
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS recipe_duplicate_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id INTEGER NOT NULL,
          candidate_recipe_id INTEGER NOT NULL,
          similarity REAL NOT NULL CHECK(similarity >= 0 AND similarity <= 1),
          reasons_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'merged', 'distinct', 'dismissed')),
          reviewed_by INTEGER,
          reviewed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(recipe_id, candidate_recipe_id),
          CHECK(recipe_id < candidate_recipe_id),
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
          FOREIGN KEY (candidate_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS recipe_coverage_baselines (
          dimension TEXT NOT NULL,
          value TEXT NOT NULL,
          minimum_candidates INTEGER NOT NULL CHECK(minimum_candidates >= 0),
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (dimension, value)
        );

        CREATE TABLE IF NOT EXISTS kitchenware_capabilities (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          safety_level TEXT NOT NULL DEFAULT 'normal' CHECK(safety_level IN ('normal', 'caution', 'restricted')),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS kitchenware_catalog_capabilities (
          catalog_id INTEGER NOT NULL,
          capability_code TEXT NOT NULL,
          constraints_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (catalog_id, capability_code),
          FOREIGN KEY (catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE CASCADE,
          FOREIGN KEY (capability_code) REFERENCES kitchenware_capabilities(code) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS kitchenware_substitutions (
          source_catalog_id INTEGER NOT NULL,
          substitute_catalog_id INTEGER NOT NULL,
          relation_type TEXT NOT NULL CHECK(relation_type IN ('equivalent', 'conditional', 'forbidden')),
          impact_json TEXT NOT NULL DEFAULT '{}',
          safety_note TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (source_catalog_id, substitute_catalog_id),
          FOREIGN KEY (source_catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE CASCADE,
          FOREIGN KEY (substitute_catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS recipe_kitchenware_requirements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id INTEGER NOT NULL,
          catalog_id INTEGER,
          capability_code TEXT,
          role TEXT NOT NULL CHECK(role IN ('required', 'optional', 'convenience')),
          source TEXT NOT NULL DEFAULT 'curated',
          confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
          notes TEXT NOT NULL DEFAULT '',
          UNIQUE(recipe_id, catalog_id, capability_code, role),
          CHECK(catalog_id IS NOT NULL OR capability_code IS NOT NULL),
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
          FOREIGN KEY (catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE CASCADE,
          FOREIGN KEY (capability_code) REFERENCES kitchenware_capabilities(code) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS kitchenware_mapping_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          raw_name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT,
          confidence REAL NOT NULL DEFAULT 0,
          suggested_catalog_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          UNIQUE(normalized_name, source_type, source_id),
          FOREIGN KEY (suggested_catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ingredients_normalized_quality
          ON ingredients_library(normalized_name, quality_status) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_recipes_canonical_quality
          ON recipes(canonical_key, quality_status) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_recipe_requirements_recipe_role
          ON recipe_kitchenware_requirements(recipe_id, role);
      `);

      const normalize = (value: string) => value.toLocaleLowerCase()
        .normalize("NFKC")
        .replace(/[\s·、，,。()（）/\\_-]/g, "")
        .trim();
      const ingredientRows = database.prepare("SELECT id, name FROM ingredients_library").all() as Array<{ id: number; name: string }>;
      const updateIngredient = database.prepare("UPDATE ingredients_library SET normalized_name = ? WHERE id = ?");
      const insertAlias = database.prepare("INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type) VALUES (?, ?, ?, ?)");
      const seedAliases: Record<string, string[]> = {
        "番茄": ["西红柿", "蕃茄", "小番茄", "圣女果"],
        "土豆": ["马铃薯", "洋芋"],
        "红薯": ["番薯", "地瓜"],
        "西兰花": ["青花菜", "花椰菜"],
        "鳄梨": ["牛油果"],
      };
      for (const ingredient of ingredientRows) {
        updateIngredient.run(normalize(ingredient.name), ingredient.id);
        insertAlias.run(ingredient.id, ingredient.name, normalize(ingredient.name), "canonical");
        for (const alias of seedAliases[ingredient.name] || []) insertAlias.run(ingredient.id, alias, normalize(alias), "synonym");
      }

      const recipeRows = database.prepare("SELECT id, title, ingredients_json, steps_json, source_revision FROM recipes").all() as Array<Record<string, unknown>>;
      const updateRecipe = database.prepare("UPDATE recipes SET canonical_key = ?, source_content_hash = ? WHERE id = ?");
      for (const recipe of recipeRows) {
        const canonical = normalize(String(recipe.title || ""));
        const hash = createHash("sha256").update(JSON.stringify({
          title: canonical,
          ingredients: recipe.ingredients_json || "[]",
          steps: recipe.steps_json || "[]",
          revision: recipe.source_revision || "",
        })).digest("hex");
        updateRecipe.run(canonical, hash, recipe.id);
      }

      const capability = database.prepare("INSERT OR IGNORE INTO kitchenware_capabilities (code, name, description, safety_level) VALUES (?, ?, ?, ?)");
      for (const [code, name, description, safety] of [
        ["fry", "煎炒", "可进行煎、炒或翻炒", "normal"],
        ["boil", "煮炖", "可进行煮、炖或煲汤", "normal"],
        ["steam", "蒸制", "可安全产生并容纳蒸汽", "caution"],
        ["bake", "烘烤", "可在受控腔体内持续干热烘烤", "caution"],
        ["blend", "搅拌粉碎", "可搅拌、打浆或粉碎", "caution"],
        ["weigh", "称量", "可进行重量测量", "normal"],
        ["cut", "切配", "可安全切割或处理食材", "caution"],
        ["temperature", "测温", "可测量食物中心温度", "normal"],
      ]) capability.run(code, name, description, safety);
      const methodCapability: Record<string, string> = {
        "煎": "fry", "炒": "fry", "爆炒": "fry", "翻面": "fry",
        "煮": "boil", "炖": "boil", "煲": "boil", "慢炖": "boil", "煲汤": "boil", "压煮": "boil",
        "蒸": "steam", "蒸煮": "steam", "烘烤": "bake", "烘焙": "bake",
        "搅拌": "blend", "打浆": "blend", "打泥": "blend", "粉碎": "blend",
        "称量": "weigh", "切配": "cut", "测温": "temperature",
      };
      const catalogRows = database.prepare("SELECT id, cooking_methods FROM kitchenware_catalog").all() as Array<{ id: number; cooking_methods: string }>;
      const linkCapability = database.prepare("INSERT OR IGNORE INTO kitchenware_catalog_capabilities (catalog_id, capability_code) VALUES (?, ?)");
      for (const item of catalogRows) {
        let methods: string[] = [];
        try { methods = JSON.parse(item.cooking_methods || "[]"); } catch { methods = []; }
        for (const method of methods) {
          const code = methodCapability[method];
          if (code) linkCapability.run(item.id, code);
        }
      }
      const findCatalog = database.prepare("SELECT id FROM kitchenware_catalog WHERE name = ?");
      const insertSubstitution = database.prepare(`INSERT OR IGNORE INTO kitchenware_substitutions
        (source_catalog_id, substitute_catalog_id, relation_type, impact_json, safety_note) VALUES (?, ?, ?, ?, ?)`);
      for (const [sourceName, substituteName, relation, impact, safety] of [
        ["平底锅", "炒锅", "equivalent", { result: "锅体更深，翻炒空间更大" }, "使用与热源兼容的锅具"],
        ["炒锅", "平底锅", "conditional", { portion: "减少单次份量", time: "可能需要分批烹饪" }, "避免食材堆叠导致受热不均"],
        ["烤箱", "空气炸锅", "conditional", { portion: "减少份量", time: "缩短并分段检查" }, "不得使用不耐高温容器"],
        ["空气炸锅", "烤箱", "conditional", { time: "适当延长预热和烘烤时间" }, "按烤箱说明设置温度"],
      ] as const) {
        const source = findCatalog.get(sourceName) as { id: number } | undefined;
        const substitute = findCatalog.get(substituteName) as { id: number } | undefined;
        if (source && substitute) insertSubstitution.run(source.id, substitute.id, relation, JSON.stringify(impact), safety);
      }
      const matchCatalog = database.prepare("SELECT id FROM kitchenware_catalog WHERE name = ?");
      const insertRequirement = database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes) VALUES (?, ?, ?, 'required', 'migration', 0.9, ?)`);
      const rules: Array<[RegExp, string, string]> = [
        [/空气炸锅/, "空气炸锅", "bake"], [/微波炉/, "微波炉", "boil"],
        [/(?:破壁机|料理机|搅拌机)/, "破壁机", "blend"], [/(?:烤箱|烘焙)/, "烤箱", "bake"],
        [/(?:电饭煲|电饭锅)/, "电饭煲", "boil"], [/(?:蒸锅|蒸笼)/, "蒸锅", "steam"],
      ];
      for (const recipe of recipeRows) {
        const text = `${recipe.title || ""} ${recipe.steps_json || ""}`;
        for (const [pattern, catalogName, capabilityCode] of rules) {
          if (!pattern.test(text)) continue;
          const catalog = matchCatalog.get(catalogName) as { id: number } | undefined;
          insertRequirement.run(recipe.id, catalog?.id || null, capabilityCode, `由菜名和步骤识别：${catalogName}`);
        }
      }
    },
  },
  {
    version: 52,
    name: "content_import_failure_audit",
    up(database) {
      addColumn(database, "recipe_import_batches", "error_json", "TEXT");
      database.exec(`
        UPDATE ingredients_library SET
          normalized_name = COALESCE(normalized_name, lower(replace(name, ' ', ''))),
          data_license = COALESCE(data_license, CASE
            WHEN source = 'usda_fdc_foundation' THEN 'US-Public-Domain'
            WHEN source = 'open_food_facts' THEN 'ODbL-1.0'
            ELSE 'DietDigiDose-Original'
          END),
          source_version = COALESCE(source_version, CASE
            WHEN source = 'usda_fdc_foundation' THEN 'USDA-FDC-foundation-seed-v1'
            WHEN source = 'open_food_facts' THEN 'OFF-imported-snapshot'
            WHEN source = 'taiwan_fda' THEN 'Taiwan-FDA-imported-snapshot'
            ELSE 'catalog-seed-v1'
          END),
          source_updated_at = COALESCE(source_updated_at, created_at),
          nutrition_basis = COALESCE(nutrition_basis, 'per_100g'),
          quality_status = COALESCE(quality_status, 'trusted');

        UPDATE recipes SET
          data_license = COALESCE(data_license, 'DietDigiDose-Original'),
          source_revision = COALESCE(source_revision, 'catalog-seed-v1'),
          source_attribution = COALESCE(source_attribution, 'DietDigiDose 编辑团队'),
          serving_size = COALESCE(serving_size, 2),
          prep_time = COALESCE(prep_time, 0),
          required_kitchenware_json = CASE WHEN required_kitchenware_json IS NULL OR required_kitchenware_json = '[]' THEN '["菜刀"]' ELSE required_kitchenware_json END;

        INSERT OR IGNORE INTO ingredient_portions (ingredient_id, label, grams, source, source_version)
          SELECT id, '100克', 100, source, source_version FROM ingredients_library WHERE deleted_at IS NULL;

        INSERT OR IGNORE INTO recipe_coverage_baselines (dimension, value, minimum_candidates) VALUES
          ('time', '15分钟', 8), ('time', '30分钟', 12), ('time', '60分钟', 12),
          ('difficulty', '简单', 20), ('difficulty', '中等', 10),
          ('budget', '低预算', 10), ('meal_type', '单人餐', 10),
          ('diet', '高蛋白', 10), ('diet', '素食', 10);
      `);
      const sources = database.prepare("SELECT DISTINCT source FROM recipes WHERE deleted_at IS NULL").all() as Array<{ source: string | null }>;
      for (const row of sources) {
        const source = row.source || "official";
        const safeSource = source.replace(/[^a-z0-9_-]/gi, "-").slice(0, 50);
        const batchId = `legacy-${safeSource}-v52`;
        database.prepare(`INSERT OR IGNORE INTO recipe_import_batches
          (id, source, source_revision, data_license, status, stats_json, completed_at)
          VALUES (?, ?, 'legacy-governance-v52', ?, 'validated', '{}', CURRENT_TIMESTAMP)`)
          .run(batchId, source, source === "wikibooks_zh" ? "CC-BY-SA-4.0" : "DietDigiDose-Original");
        database.prepare("UPDATE recipes SET import_batch_id = COALESCE(import_batch_id, ?) WHERE source IS ? AND deleted_at IS NULL")
          .run(batchId, row.source);
      }
      const knife = database.prepare("SELECT id FROM kitchenware_catalog WHERE name = '菜刀'").get() as { id: number } | undefined;
      if (knife) {
        database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
          (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
          SELECT r.id, ?, 'cut', 'required', 'migration-v52', 1, '基础切配'
          FROM recipes r WHERE r.deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM recipe_kitchenware_requirements k WHERE k.recipe_id = r.id AND k.role = 'required')`)
          .run(knife.id);
      }
    },
  },
  {
    version: 53,
    name: "durable_media_cleanup_jobs",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS media_cleanup_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id INTEGER NOT NULL,
          urls_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
        );

        CREATE INDEX IF NOT EXISTS idx_media_cleanup_jobs_status_created
          ON media_cleanup_jobs(status, created_at, id);
      `);
    },
  },
  {
    version: 54,
    name: "media_cleanup_job_leases",
    up(database) {
      const columns = database.prepare("PRAGMA table_info(media_cleanup_jobs)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "claim_token")) {
        database.exec("ALTER TABLE media_cleanup_jobs ADD COLUMN claim_token TEXT");
      }
      if (!columns.some((column) => column.name === "claimed_at")) {
        database.exec("ALTER TABLE media_cleanup_jobs ADD COLUMN claimed_at DATETIME");
      }
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_media_cleanup_jobs_claim
          ON media_cleanup_jobs(status, claimed_at, created_at, id);
      `);
    },
  },
  {
    version: 55,
    name: "media_cleanup_stable_object_references",
    up(database) {
      addColumn(database, "media_cleanup_jobs", "objects_json", "TEXT");
    },
  },
  {
    version: 56,
    name: "governed_voice_pack_catalog",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS voice_pack_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voice_id TEXT NOT NULL,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'zh-CN',
          style_tags_json TEXT NOT NULL DEFAULT '[]',
          manifest_json TEXT NOT NULL,
          resource_fingerprint TEXT NOT NULL UNIQUE,
          provider_voice TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'disabled', 'revoked')),
          revision INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER,
          reviewed_by INTEGER,
          published_at DATETIME,
          revoked_at DATETIME,
          revoke_reason TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(voice_id, version),
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS voice_pack_status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voice_pack_version_id INTEGER NOT NULL,
          actor_user_id INTEGER,
          from_status TEXT,
          to_status TEXT NOT NULL,
          reason TEXT,
          revision INTEGER NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (voice_pack_version_id) REFERENCES voice_pack_versions(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_voice_pack_versions_status_voice
          ON voice_pack_versions(status, voice_id, version);
        CREATE INDEX IF NOT EXISTS idx_voice_pack_history_version_created
          ON voice_pack_status_history(voice_pack_version_id, created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 57,
    name: "account_scoped_voice_preferences",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_voice_preferences (
          user_id INTEGER PRIMARY KEY,
          selected_voice_id TEXT,
          selected_version TEXT,
          preference TEXT NOT NULL DEFAULT 'automatic' CHECK(preference IN ('automatic', 'system-only')),
          version INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 58,
    name: "realtime_voice_incremental_transcripts",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS realtime_voice_transcript_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          transcript TEXT NOT NULL DEFAULT '',
          is_final INTEGER NOT NULL DEFAULT 0,
          audio_bytes INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, turn_id, sequence),
          FOREIGN KEY (session_id) REFERENCES realtime_voice_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_realtime_voice_chunks_turn_sequence
          ON realtime_voice_transcript_chunks(session_id, turn_id, sequence);
      `);
    },
  },
  {
    version: 59,
    name: "independent_worker_task_runs",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS worker_task_leases (
          task_name TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          lease_expires_at DATETIME NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS worker_task_runs (
          id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          worker_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at DATETIME,
          duration_ms INTEGER,
          processed_count INTEGER NOT NULL DEFAULT 0,
          succeeded_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          result_json TEXT,
          error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_worker_task_runs_task_started
          ON worker_task_runs(task_name, started_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_worker_task_runs_status_started
          ON worker_task_runs(status, started_at DESC, id DESC);
      `);
    },
  },
  {
    version: 60,
    name: "backfill_legacy_media_cleanup_references",
    up(database) {
      const rows = database.prepare(`SELECT id, owner_user_id, urls_json, status
        FROM media_cleanup_jobs WHERE objects_json IS NULL`).all() as Array<{
          id: number;
          owner_user_id: number;
          urls_json: string;
          status: string;
        }>;
      const save = database.prepare(`UPDATE media_cleanup_jobs SET objects_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND objects_json IS NULL`);
      const recoverCompleted = database.prepare(`UPDATE media_cleanup_jobs SET objects_json = ?, status = 'pending',
        last_error = '历史媒体清理任务已恢复，等待重新验证删除', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND objects_json IS NULL AND status = 'completed'`);

      for (const row of rows) {
        let urls: unknown;
        try {
          urls = JSON.parse(row.urls_json);
        } catch {
          continue;
        }
        if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) continue;
        const urlList = urls as string[];
        const fullyDescribed = urlList.every((url) => !url.length
          || describeHistoricalStoredMediaUrls(row.owner_user_id, [url]).length > 0);
        if (!fullyDescribed) continue;
        const references = describeHistoricalStoredMediaUrls(row.owner_user_id, urlList);
        const serialized = JSON.stringify(references);
        if (row.status === "completed" && references.length > 0) recoverCompleted.run(serialized, row.id);
        else save.run(serialized, row.id);
      }
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
