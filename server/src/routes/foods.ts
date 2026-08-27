import { Router } from 'express';
import { db } from '../storage/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { customFoodSchema } from '../validation/schemas.js';
import { searchFoodUSDA } from '../services/foodApiAdapter.js';
import { sharedRateLimit } from '../middleware/sharedRateLimit.js';
import { normalizeContentTerm, recordIngredientSearchGap } from '../services/contentGovernance.js';

const router = Router();
const anonymousSearchRateLimit = sharedRateLimit({
  namespace: 'food-search',
  limit: Math.max(1, Number(process.env.FOOD_SEARCH_RATE_LIMIT) || 60),
  windowMs: 15 * 60 * 1000,
  key: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  message: '食品查询过于频繁，请稍后重试',
  code: 'FOOD_SEARCH_RATE_LIMITED',
});

router.get('/barcode/:barcode', anonymousSearchRateLimit, (req, res) => {
  const barcode = String(req.params.barcode || '').trim();
  if (!/^\d{8,14}$/.test(barcode)) return res.status(400).json({ error: '条码格式无效', code: 'INVALID_BARCODE' });
  const food = db.prepare(`
    SELECT id, name, category, image_url, brands, barcode, original_name
    FROM ingredients_library
    WHERE barcode = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(barcode);
  if (!food) return res.status(404).json({ error: '食品库暂未收录该条码', code: 'BARCODE_NOT_FOUND' });
  return res.json(food);
});

// GET /api/v1/foods/search?query=xxx
router.get('/search', anonymousSearchRateLimit, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: '搜索词不能为空' });
    }

    const normalizedQuery = normalizeContentTerm(query);
    if (!normalizedQuery) return res.status(400).json({ error: '搜索词不能为空' });

    // 1. Search governed local records and aliases first. Only trusted records
    // are eligible for inventory/nutrition use.
    const localFoods = db.prepare(`
      SELECT DISTINCT i.id, i.name, i.category, i.calories_100g, i.protein_100g, i.carbs_100g, i.fat_100g,
        i.image_url, i.brands, i.barcode, i.micronutrients_json, i.source,
        i.quality_status, i.source_version, i.data_license, i.preparation_state,
        i.nutrition_basis, i.edible_ratio
      FROM ingredients_library i
      LEFT JOIN ingredient_aliases a ON a.ingredient_id = i.id
      WHERE i.deleted_at IS NULL
        AND i.quality_status = 'trusted'
        AND (i.normalized_name LIKE ? OR a.normalized_alias LIKE ? OR i.search_keywords LIKE ?)
      ORDER BY CASE WHEN i.normalized_name = ? THEN 0 WHEN a.normalized_alias = ? THEN 1 ELSE 2 END, i.id
      LIMIT 10
    `).all(`%${normalizedQuery}%`, `%${normalizedQuery}%`, `%${normalizedQuery}%`, normalizedQuery, normalizedQuery) as any[];

    // If we have enough local results, return them to be fast
    if (localFoods.length >= 5) {
      return res.json(localFoods);
    }

    if (!localFoods.length) recordIngredientSearchGap(query);

    // 2. Fetch from USDA if local results are insufficient. External rows are
    // deliberately returned as unverified suggestions and never written into
    // the canonical library until an audited import/review batch accepts them.
    const externalFoods = await searchFoodUSDA(query);
    const suggestions = externalFoods.map((food) => ({
      ...food,
      id: null,
      quality_status: 'external_unverified',
      cacheable: false,
      requires_review: true,
    }));

    const combined = [...localFoods, ...suggestions].slice(0, 15).map((food: any) => {
      let micronutrients = null;
      try {
        micronutrients = food.micronutrients_json ? JSON.parse(food.micronutrients_json) : null;
      } catch {
        micronutrients = null;
      }
      const { micronutrients_json, ...result } = food;
      return { ...result, micronutrients };
    });
    res.json(combined);
  } catch (error) {
    console.error('Food search error:', error);
    res.status(500).json({ error: '搜索失败' });
  }
});

// POST /api/v1/foods/custom (User Submits UGC Food)
router.post('/custom', authMiddleware, validateBody(customFoodSchema), (req: any, res) => {
  try {
    const { name, calories_100g, protein_100g, carbs_100g, fat_100g } = req.body;
    
    const insert = db.prepare(`
      INSERT INTO user_custom_foods (user_id, name, calories_100g, protein_100g, carbs_100g, fat_100g, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    
    const info = insert.run(req.userId, name, calories_100g, protein_100g, carbs_100g, fat_100g);
    
    res.json({ success: true, id: info.lastInsertRowid, message: '提交成功，等待管理员审核后将公开' });
  } catch (error) {
    res.status(500).json({ error: '提交自定义食材失败' });
  }
});

export default router;
