/**
 * 从 Open Food Facts 公共数据库导入带营养标签和图片的食材/食品。
 * 数据许可：ODbL 1.0；图片许可以产品页面标注为准。
 *
 * 用法：pnpm --dir server import:open-food-facts -- --limit=1200 --page-start=1
 */
import { db, initDatabase } from '../src/storage/db.js';

type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_zh?: string;
  product_name_zh_cn?: string;
  brands?: string;
  categories_tags?: string[];
  image_front_url?: string;
  image_url?: string;
  nutriments?: Record<string, unknown>;
};

const args = process.argv.slice(2);
const rawLimit = args.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
const rawPageStart = args.find((arg) => arg.startsWith('--page-start='))?.split('=')[1];
const limit = Math.min(Math.max(Number(rawLimit) || 1200, 1), 10_000);
const pageStart = Math.max(Number(rawPageStart) || 1, 1);
const pageSize = 100;
const fields = [
  'code', 'product_name', 'product_name_zh', 'product_name_zh_cn', 'brands', 'categories_tags',
  'image_front_url', 'image_url', 'nutriments', 'nutrition_data_per',
].join(',');

function categoryFor(tags: string[] = []): string {
  const text = tags.join(' ').toLowerCase();
  if (/fruit|vegetable|mushroom|plant-based-food/.test(text)) return '蔬菜水果';
  if (/fish|meat|poultry|seafood|egg/.test(text)) return '肉食蛋类';
  if (/milk|cheese|yogurt|dairy/.test(text)) return '乳制品';
  if (/cereal|bread|pasta|rice|grain|flour/.test(text)) return '粮油干货';
  if (/nut|seed|legume|bean/.test(text)) return '坚果豆类';
  if (/beverage|drink|water/.test(text)) return '饮品';
  return '其他食品';
}

function numberAt(nutriments: Record<string, unknown>, key: string): number {
  const value = nutriments[`${key}_100g`] ?? nutriments[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function micronutrients(nutriments: Record<string, unknown>): Record<string, { value: number; unit: string }> {
  const excluded = new Set(['energy', 'energy-kcal', 'energy-kj', 'proteins', 'carbohydrates', 'fat']);
  const result: Record<string, { value: number; unit: string }> = {};
  for (const [key, value] of Object.entries(nutriments)) {
    if (!key.endsWith('_100g') || typeof value !== 'number' || !Number.isFinite(value)) continue;
    const nutrient = key.slice(0, -'_100g'.length);
    if (excluded.has(nutrient)) continue;
    const unit = nutriments[`${nutrient}_unit`];
    result[nutrient] = { value, unit: typeof unit === 'string' ? unit : 'g' };
  }
  return result;
}

async function fetchPage(page: number): Promise<OffProduct[]> {
  // 主站出现维护性 503 时，官方 .net 镜像通常仍可用。
  const url = new URL('https://world.openfoodfacts.net/api/v2/search');
  url.searchParams.set('fields', fields);
  url.searchParams.set('nutrition_data_per', '100g');
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('page', String(page));
  let lastError = '未知错误';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'DietDigiDose/1.0 (open-food-catalog-import)' },
      });
      if (response.ok) {
        const body = await response.json() as { products?: OffProduct[] };
        return body.products || [];
      }
      lastError = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`Open Food Facts 请求失败：${lastError}`);
}

async function main() {
  initDatabase();
  const existing = db.prepare('SELECT id FROM ingredients_library WHERE barcode = ? AND deleted_at IS NULL LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO ingredients_library (
      name, category, calories_100g, protein_100g, carbs_100g, fat_100g, image_url,
      source, barcode, brands, micronutrients_json, data_license
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open_food_facts', ?, ?, ?, 'ODbL-1.0')
  `);
  const update = db.prepare(`
    UPDATE ingredients_library SET
      calories_100g = ?, protein_100g = ?, carbs_100g = ?, fat_100g = ?, image_url = COALESCE(?, image_url),
      brands = COALESCE(?, brands), micronutrients_json = ?, data_license = 'ODbL-1.0'
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let scanned = 0;
  const maxPages = Math.ceil(limit / pageSize);
  for (let page = pageStart; page < pageStart + maxPages && inserted < limit; page += 1) {
    const products = await fetchPage(page);
    if (!products.length) break;
    const transaction = db.transaction(() => {
      for (const product of products) {
        scanned += 1;
        const nutrients = product.nutriments || {};
        const baseName = product.product_name_zh_cn || product.product_name_zh || product.product_name;
        const barcode = product.code?.trim();
        if (!baseName?.trim() || !barcode || !Object.keys(nutrients).length) continue;
        const brand = product.brands?.trim() || null;
        const name = brand ? `${baseName.trim()}（${brand}）` : baseName.trim();
        const values = [
          numberAt(nutrients, 'energy-kcal'), numberAt(nutrients, 'proteins'), numberAt(nutrients, 'carbohydrates'),
          numberAt(nutrients, 'fat'), product.image_front_url || product.image_url || null, brand,
          JSON.stringify(micronutrients(nutrients)),
        ] as const;
        const row = existing.get(barcode) as { id: number } | undefined;
        if (row) {
          update.run(...values, row.id);
          updated += 1;
        } else if (inserted < limit) {
          insert.run(name, categoryFor(product.categories_tags), values[0], values[1], values[2], values[3], values[4], barcode, brand, values[6]);
          inserted += 1;
        }
      }
    });
    transaction();
    console.log(`已处理第 ${page} 页；新增 ${inserted}，更新 ${updated}`);
    if (page < pageStart + maxPages - 1) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(JSON.stringify({ scanned, inserted, updated, total: (db.prepare('SELECT COUNT(*) AS count FROM ingredients_library WHERE deleted_at IS NULL').get() as { count: number }).count }));
  db.close();
}

main().catch((error) => {
  console.error(error);
  db.close();
  process.exitCode = 1;
});
