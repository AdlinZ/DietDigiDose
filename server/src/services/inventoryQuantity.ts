import type Database from "better-sqlite3";

export const INVENTORY_UNITS = ["g", "kg", "ml", "l", "piece", "serving", "bag", "box", "bottle", "can"] as const;
export type InventoryUnit = typeof INVENTORY_UNITS[number];

type UnitDefinition = { family: string; factor: number; label: string };
const UNIT_DEFINITIONS: Record<InventoryUnit, UnitDefinition> = {
  g: { family: "mass", factor: 1, label: "g" },
  kg: { family: "mass", factor: 1000, label: "kg" },
  ml: { family: "volume", factor: 1, label: "ml" },
  l: { family: "volume", factor: 1000, label: "L" },
  piece: { family: "piece", factor: 1, label: "个" },
  serving: { family: "serving", factor: 1, label: "份" },
  bag: { family: "bag", factor: 1, label: "袋" },
  box: { family: "box", factor: 1, label: "盒" },
  bottle: { family: "bottle", factor: 1, label: "瓶" },
  can: { family: "can", factor: 1, label: "罐" },
};

export class InventoryQuantityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryQuantityError";
    this.code = code;
  }
}

export type InventoryConsumption = {
  item_id: number;
  version: number;
  mode: "amount" | "all";
  amount_value?: number;
  unit?: InventoryUnit;
};

export type InventoryConsumptionState = {
  id: unknown;
  food_name: unknown;
  quantity: unknown;
  quantity_value: unknown;
  quantity_unit: unknown;
  is_available: unknown;
  version: unknown;
};

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function displayQuantity(value: number, unit: InventoryUnit) {
  return `${roundQuantity(value)}${UNIT_DEFINITIONS[unit].label}`;
}

function convert(value: number, from: InventoryUnit, to: InventoryUnit) {
  const source = UNIT_DEFINITIONS[from];
  const target = UNIT_DEFINITIONS[to];
  if (source.family !== target.family) {
    throw new InventoryQuantityError("INVENTORY_UNIT_MISMATCH", `${source.label} 与 ${target.label} 不能安全换算`);
  }
  return value * source.factor / target.factor;
}

/** Driver-neutral quantity transition used by SQLite and PostgreSQL adapters. */
export function calculateInventoryConsumption(item: InventoryConsumptionState, consumption: InventoryConsumption) {
  if (!item.is_available) {
    throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
  }
  if (Number(item.version) !== consumption.version) {
    throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已在其他设备更新，请刷新后重试");
  }
  const storedValue = item.quantity_value == null ? null : Number(item.quantity_value);
  const storedUnit = typeof item.quantity_unit === "string" && INVENTORY_UNITS.includes(item.quantity_unit as InventoryUnit)
    ? item.quantity_unit as InventoryUnit
    : null;
  let amountUsed = storedValue;
  let remaining = 0;
  let available = false;
  if (consumption.mode === "amount") {
    if (storedValue === null || !storedUnit) {
      throw new InventoryQuantityError("STRUCTURED_QUANTITY_REQUIRED", `“${String(item.food_name)}”没有可安全部分扣减的结构化数量`);
    }
    if (!consumption.unit || !Number.isFinite(consumption.amount_value) || Number(consumption.amount_value) <= 0) {
      throw new InventoryQuantityError("INVALID_CONSUMPTION_AMOUNT", "扣减数量必须大于 0");
    }
    amountUsed = convert(Number(consumption.amount_value), consumption.unit, storedUnit);
    if (amountUsed > storedValue + 0.0001) {
      throw new InventoryQuantityError("INVENTORY_INSUFFICIENT", `“${String(item.food_name)}”的剩余数量不足`);
    }
    remaining = Math.max(0, roundQuantity(storedValue - amountUsed));
    available = remaining > 0;
  }
  return {
    storedValue,
    storedUnit,
    amountUsed,
    remaining,
    available,
    nextQuantity: storedUnit && storedValue !== null ? displayQuantity(remaining, storedUnit) : String(item.quantity),
  };
}

export function applyInventoryConsumptions(
  database: Database.Database,
  userId: number,
  consumptions: InventoryConsumption[],
  options: { idempotencyKey: string; source: string; metadata?: Record<string, unknown> },
) {
  const select = database.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL");
  const update = database.prepare(`
    UPDATE inventory_items SET quantity = ?, quantity_value = ?, is_available = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ? AND is_available = 1 AND deleted_at IS NULL
  `);
  const log = database.prepare(`
    INSERT INTO inventory_change_logs
      (user_id, inventory_item_id, action, source, quantity_before, quantity_after,
       quantity_unit, delta_value, idempotency_key, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return consumptions.map((consumption, index) => {
    const item = select.get(consumption.item_id, userId) as Record<string, unknown> | undefined;
    if (!item || !item.is_available) {
      throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
    }
    if (Number(item.version) !== consumption.version) {
      throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已在其他设备更新，请刷新后重试");
    }

    const storedValue = item.quantity_value === null || item.quantity_value === undefined
      ? null
      : Number(item.quantity_value);
    const storedUnit = typeof item.quantity_unit === "string" && INVENTORY_UNITS.includes(item.quantity_unit as InventoryUnit)
      ? item.quantity_unit as InventoryUnit
      : null;
    let amountUsed = storedValue;
    let remaining = 0;
    let available = false;

    if (consumption.mode === "amount") {
      if (storedValue === null || !storedUnit) {
        throw new InventoryQuantityError("STRUCTURED_QUANTITY_REQUIRED", `“${item.food_name}”没有可安全部分扣减的结构化数量`);
      }
      if (!consumption.unit || !Number.isFinite(consumption.amount_value) || Number(consumption.amount_value) <= 0) {
        throw new InventoryQuantityError("INVALID_CONSUMPTION_AMOUNT", "扣减数量必须大于 0");
      }
      amountUsed = convert(Number(consumption.amount_value), consumption.unit, storedUnit);
      if (amountUsed > storedValue + 0.0001) {
        throw new InventoryQuantityError("INVENTORY_INSUFFICIENT", `“${item.food_name}”的剩余数量不足`);
      }
      remaining = Math.max(0, roundQuantity(storedValue - amountUsed));
      available = remaining > 0;
    }

    const nextQuantity = storedUnit && storedValue !== null
      ? displayQuantity(remaining, storedUnit)
      : String(item.quantity);
    const result = update.run(
      nextQuantity,
      storedValue === null ? null : remaining,
      available ? 1 : 0,
      consumption.item_id,
      userId,
      consumption.version,
    );
    if (result.changes !== 1) {
      throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
    }
    log.run(
      userId,
      consumption.item_id,
      consumption.mode === "all" ? "consume_all" : "consume_partial",
      options.source,
      storedValue,
      storedValue === null ? null : remaining,
      storedUnit,
      amountUsed === null ? null : -roundQuantity(amountUsed),
      `${options.idempotencyKey}:${consumption.item_id}:${index}`,
      JSON.stringify(options.metadata || {}),
    );
    return {
      item_id: consumption.item_id,
      quantity_before: storedValue,
      quantity_after: storedValue === null ? null : remaining,
      quantity_unit: storedUnit,
      consumed_value: amountUsed,
      is_available: available,
      version: consumption.version + 1,
    };
  });
}

function normalizeFoodName(value: string) {
  return value.toLocaleLowerCase().replace(/[\s·、，,。()（）/\\_-]/g, "");
}

export function buildFefoConsumptionPreview(
  database: Database.Database,
  userId: number,
  requests: Array<{ food_name: string; amount_value: number; unit: InventoryUnit }>,
) {
  const inventory = database.prepare(`
    SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version
    FROM inventory_items
    WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL
    ORDER BY expiration_date ASC, id ASC
  `).all(userId) as Array<{
    id: unknown;
    food_name: unknown;
    quantity_value: unknown;
    quantity_unit: unknown;
    expiration_date: unknown;
    batch_code: unknown;
    version: unknown;
  }>;

  return buildFefoConsumptionPreviewFromCandidates(inventory, requests);
}

export function buildFefoConsumptionPreviewFromCandidates(
  inventory: Array<{
    id: unknown;
    food_name: unknown;
    quantity_value: unknown;
    quantity_unit: unknown;
    expiration_date: unknown;
    batch_code: unknown;
    version: unknown;
  }>,
  requests: Array<{ food_name: string; amount_value: number; unit: InventoryUnit }>,
) {
  return requests.map((request) => {
    let remaining = request.amount_value;
    const deductions: Array<Record<string, unknown>> = [];
    const requestName = normalizeFoodName(request.food_name);
    for (const item of inventory) {
      if (remaining <= 0.0001) break;
      const candidateName = normalizeFoodName(String(item.food_name));
      if (!(candidateName.includes(requestName) || requestName.includes(candidateName))) continue;
      const unit = item.quantity_unit as InventoryUnit | null;
      const value = Number(item.quantity_value);
      if (!unit || !INVENTORY_UNITS.includes(unit) || !Number.isFinite(value) || value <= 0) continue;
      let availableInRequestUnit: number;
      try {
        availableInRequestUnit = convert(value, unit, request.unit);
      } catch {
        continue;
      }
      const amount = Math.min(remaining, availableInRequestUnit);
      deductions.push({
        item_id: Number(item.id),
        version: Number(item.version),
        food_name: String(item.food_name),
        expiration_date: String(item.expiration_date),
        batch_code: item.batch_code ? String(item.batch_code) : null,
        mode: amount >= availableInRequestUnit - 0.0001 ? "all" : "amount",
        amount_value: roundQuantity(amount),
        unit: request.unit,
      });
      remaining = roundQuantity(remaining - amount);
    }
    return {
      food_name: request.food_name,
      requested_value: request.amount_value,
      unit: request.unit,
      covered_value: roundQuantity(request.amount_value - remaining),
      missing_value: Math.max(0, remaining),
      fully_covered: remaining <= 0.0001,
      deductions,
    };
  });
}
