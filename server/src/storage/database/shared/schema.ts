import { pgTable, serial, varchar, text, timestamp, integer, real, boolean, jsonb, index } from "drizzle-orm/pg-core"

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 食材基础信息表
export const foodItems = pgTable(
  "food_items",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(), // 蔬菜、水果、肉类、乳制品、谷物、调料等
    calories: real("calories"), // 每100g热量(kcal)
    protein: real("protein"), // 蛋白质(g)
    carbs: real("carbs"), // 碳水(g)
    fat: real("fat"), // 脂肪(g)
    fiber: real("fiber"), // 膳食纤维(g)
    image_url: text("image_url"),
    shelf_life_days: integer("shelf_life_days"), // 默认保质期(天)
    health_label: varchar("health_label", { length: 20 }).default("健康"), // 健康/普通/谨慎
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("food_items_category_idx").on(table.category),
    index("food_items_name_idx").on(table.name),
  ]
);

// 用户食材库存表
export const userInventory = pgTable(
  "user_inventory",
  {
    id: serial("id").primaryKey(),
    food_name: varchar("food_name", { length: 150 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    quantity: varchar("quantity", { length: 50 }).notNull(), // 如 "500g", "3个"
    purchase_date: varchar("purchase_date", { length: 20 }), // 购买日期
    expiration_date: varchar("expiration_date", { length: 20 }).notNull(), // 过期日期
    storage_location: varchar("storage_location", { length: 50 }).default("冰箱"), // 冰箱/橱柜/冷冻
    image_url: text("image_url"),
    is_available: boolean("is_available").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_inventory_expiration_idx").on(table.expiration_date),
    index("user_inventory_category_idx").on(table.category),
  ]
);

// 饮食记录表
export const dietRecords = pgTable(
  "diet_records",
  {
    id: serial("id").primaryKey(),
    meal_type: varchar("meal_type", { length: 20 }).notNull(), // 早餐/午餐/晚餐/加餐
    food_name: varchar("food_name", { length: 150 }).notNull(),
    quantity: varchar("quantity", { length: 50 }), // 摄入量
    calories: real("calories"), // 热量
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    meal_date: varchar("meal_date", { length: 20 }).notNull(), // 日期 YYYY-MM-DD
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("diet_records_date_idx").on(table.meal_date),
    index("diet_records_meal_type_idx").on(table.meal_type),
  ]
);

// 用户健康数据表
export const userHealthData = pgTable(
  "user_health_data",
  {
    id: serial("id").primaryKey(),
    height: real("height"), // cm
    weight: real("weight"), // kg
    age: integer("age"),
    gender: varchar("gender", { length: 10 }), // male/female
    activity_level: varchar("activity_level", { length: 30 }).default("moderate"), // sedentary/light/moderate/active/very_active
    health_goal: varchar("health_goal", { length: 30 }).default("maintain"), // lose_weight/gain_muscle/maintain/healthy
    dietary_restrictions: text("dietary_restrictions"), // JSON string of allergies/restrictions
    target_weight: real("target_weight"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// 菜谱表
export const recipes = pgTable(
  "recipes",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    image_url: text("image_url"),
    ingredients: jsonb("ingredients"), // [{name, amount}]
    steps: jsonb("steps"), // [string]
    cook_time: integer("cook_time"), // 分钟
    difficulty: varchar("difficulty", { length: 20 }).default("简单"), // 简单/中等/困难
    calories: real("calories"), // 总热量
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    nutrition: jsonb("nutrition_json"), // 可扩展营养项 [{key,label,value,unit}]
    category: varchar("category", { length: 50 }), // 减脂/增肌/营养餐单/低卡/快手菜
    tags: jsonb("tags"), // ["低卡", "高蛋白"]
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("recipes_category_idx").on(table.category),
  ]
);

// 社区帖子表
export const communityPosts = pgTable(
  "community_posts",
  {
    id: serial("id").primaryKey(),
    author_name: varchar("author_name", { length: 50 }).notNull(),
    author_avatar: text("author_avatar"),
    title: varchar("title", { length: 255 }),
    content: text("content").notNull(),
    image_url: text("image_url"),
    category: varchar("category", { length: 30 }).default("分享"), // 分享/提问/打卡
    event_start_at: timestamp("event_start_at", { withTimezone: true }),
    event_end_at: timestamp("event_end_at", { withTimezone: true }),
    question_status: varchar("question_status", { length: 20 }).default("open"),
    accepted_comment_id: integer("accepted_comment_id"),
    like_count: integer("like_count").default(0).notNull(),
    comment_count: integer("comment_count").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("community_posts_category_idx").on(table.category),
    index("community_posts_created_at_idx").on(table.created_at),
  ]
);
