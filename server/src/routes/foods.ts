import { Router } from 'express';
import { db } from '../storage/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { customFoodSchema } from '../validation/schemas.js';
import { searchFoodUSDA } from '../services/foodApiAdapter.js';

const router = Router();

// GET /api/v1/foods/search?query=xxx
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: '搜索词不能为空' });
    }

    // 1. Search Local Database first
    const localFoods = db.prepare(`
      SELECT id, name, category, calories_100g, protein_100g, carbs_100g, fat_100g,
        image_url, brands, barcode, micronutrients_json, source
      FROM ingredients_library 
      WHERE name LIKE ? AND deleted_at IS NULL
      LIMIT 10
    `).all(`%${query}%`) as any[];

    // If we have enough local results, return them to be fast
    if (localFoods.length >= 5) {
      return res.json(localFoods);
    }

    // 2. Fetch from USDA API if local results are insufficient
    const externalFoods = await searchFoodUSDA(query);

    // 3. Cache external results into local DB
    const insert = db.prepare(`
      INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const cachedResults = [];
    for (const food of externalFoods) {
      try {
        // Simple deduplication logic: check if name exactly matches
        const existing = db.prepare('SELECT id FROM ingredients_library WHERE name = ? AND deleted_at IS NULL').get(food.name);
        if (!existing) {
          const info = insert.run(food.name, food.calories_100g, food.protein_100g, food.carbs_100g, food.fat_100g, food.source);
          cachedResults.push({ id: info.lastInsertRowid, ...food });
        }
      } catch (e) {
        console.error('Error caching food:', e);
      }
    }

    // Combine local + newly cached results
    const combined = [...localFoods, ...cachedResults].slice(0, 15).map((food: any) => {
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
