import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diningSupply } from '../src/modules/households/diningSupply.js';
import { checkDiningRecipe } from '../src/modules/households/recipeConstraints.js';
const recipe = { id: 1,title: '米饭',description: null,ingredients_json: [{ name: '大米',amount: '100g' }],serving_size: 1 };
const plan = (id: string,date: string,servings: number,protect = false) => ({ id,planned_date: date,protected: protect,recipe_id: 1,recipe_title: '米饭',recipe_description: null,recipe_ingredients: recipe.ingredients_json,recipe_yield: 1,dining_json: { householdId: 1,participants: [{ membershipId: 1,version: 1,servings }],constraintsReviewed: true } });
const run = (plans: ReturnType<typeof plan>[],inventory: Record<string,unknown>[]) => diningSupply({ plans,inventory,targetId: 'target',totalServings: 3,recipeFingerprint: checkDiningRecipe(recipe,[],3).fingerprint,today: '2036-09-12' });
test('shared stock is spent only once across meals, with expiry checked for each meal',() => {
 const inventory = [{ id: 1,food_name: '大米',quantity: '0.3kg',expiration_date: '2036-09-13',is_available: true },{ id: 2,food_name: '大米',quantity: '200g',expiration_date: '2036-09-30',is_available: true }];
 assert.deepEqual(run([plan('earlier','2036-09-12',2),plan('target','2036-09-13',3)],inventory).demands.map(row => [row.covered,row.missing]),[[300,0]]);
 assert.deepEqual(run([plan('earlier','2036-09-12',2),plan('target','2036-09-14',3)],inventory).demands.map(row => [row.covered,row.missing]),[[200,100]]);
 assert.deepEqual(run([plan('future','2036-09-20',2,true),plan('target','2036-09-13',3)],inventory).demands.map(row => [row.covered,row.missing]),[[300,0]]);
 assert.equal(inventory[0].quantity,'0.3kg');
});
test('unknown competing demand never certifies a net shopping quantity',() => {
 const other = plan('other','2036-09-12',1); other.recipe_ingredients = [{ name: '大米',amount: '适量' }];
 const result = run([other,plan('target','2036-09-13',3)],[]);
 assert.equal(result.status,'needs_review'); assert.equal(result.demands[0]?.missing,null);
});

test('expired, uncertain and invalid-date stock never certifies coverage',() => {
 const plans = [plan('target','2036-09-13',3)];
 const expired = run(plans,[{ id: 1,food_name: '大米',quantity: '500g',expiration_date: '2036-09-12',is_available: true }]);
 assert.equal(expired.demands[0]?.covered,0); assert.equal(expired.demands[0]?.missing,300);
 for (const row of [{ quantity: '适量',expiration_date: '2036-09-30' },{ quantity: '500g',expiration_date: '2036-02-30' }]) {
   const uncertain = run(plans,[{ id: 1,food_name: '大米',is_available: true,...row }]);
   assert.equal(uncertain.status,'needs_review'); assert.equal(uncertain.demands[0]?.missing,null);
 }
});
