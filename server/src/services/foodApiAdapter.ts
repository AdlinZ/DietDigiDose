/**
 * Adapter for External Food Data APIs
 * Implements fallback and standard conversion logic.
 */

// USDA API requires an API key. We use DEMO_KEY by default which has rate limits.
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';

export type StandardFoodInfo = {
  name: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  source: string;
};

export async function searchFoodUSDA(query: string): Promise<StandardFoodInfo[]> {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${USDA_API_KEY}&pageSize=5`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('USDA API Error:', response.statusText);
      return [];
    }

    const data = (await response.json()) as any;
    const results: StandardFoodInfo[] = [];

    if (data.foods && Array.isArray(data.foods)) {
      for (const item of data.foods) {
        // USDA provides nutrients array. We need to extract Energy (kcal), Protein (g), Carbohydrate (g), Total lipid (fat) (g).
        // Usually, these are per 100g in USDA unless specified otherwise.
        let calories = 0, protein = 0, carbs = 0, fat = 0;
        
        for (const n of item.foodNutrients || []) {
          const name = n.nutrientName?.toLowerCase() || '';
          if (name.includes('energy') && n.unitName === 'KCAL') calories = n.value;
          else if (name.includes('protein') && n.unitName === 'G') protein = n.value;
          else if (name.includes('carbohydrate') && n.unitName === 'G') carbs = n.value;
          else if (name.includes('lipid (fat)') && n.unitName === 'G') fat = n.value;
        }

        // Only add if we found calories
        if (calories > 0) {
          results.push({
            name: item.description,
            calories_100g: Number(calories.toFixed(1)),
            protein_100g: Number(protein.toFixed(1)),
            carbs_100g: Number(carbs.toFixed(1)),
            fat_100g: Number(fat.toFixed(1)),
            source: 'open_api', // Tag as external API
          });
        }
      }
    }
    return results;
  } catch (error) {
    console.error('Failed to fetch from USDA:', error);
    return [];
  }
}
