import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { repairBaseDataKitchenware } from '../scripts/base-data-kitchenware.mjs';

test('base data kitchenware repairs legacy rows atomically and preserves reviewed mappings', {
  skip: !process.env.TEST_BASE_DATA_DATABASE_URL,
}, async () => {
  const db = new pg.Client({ connectionString: process.env.TEST_BASE_DATA_DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Temporary tables isolate the test from any persistent database contents.
    await db.query(`CREATE TEMP TABLE recipes(id integer PRIMARY KEY,source text,external_id text,source_revision text,required_kitchenware_json jsonb);
      CREATE TEMP TABLE recipe_kitchenware_requirements(recipe_id integer,catalog_id integer,role text,source text,confidence float,notes text,
        CHECK(catalog_id>0));`);
    const required = [{ catalog_id: 10,name: '蒸锅' },{ catalog_id: 20,name: '菜刀' }];
    const legacy = required.map(({ catalog_id }) => ({ catalog_id }));
    for (let id=1;id<=4;id++) await db.query(`INSERT INTO recipes VALUES($1,'base_data',$2,'rc7',$3::jsonb)`,[id,`recipe-${id}`,JSON.stringify(legacy)]);
    assert.equal(await repairBaseDataKitchenware(db,1,'recipe-1','rc7',required),true);
    assert.deepEqual((await db.query('SELECT required_kitchenware_json FROM recipes WHERE id=1')).rows[0].required_kitchenware_json,required);
    assert.deepEqual((await db.query('SELECT catalog_id,role,notes FROM recipe_kitchenware_requirements ORDER BY catalog_id')).rows,
      required.map(item => ({ catalog_id: item.catalog_id,role: 'required',notes: item.name })));
    assert.equal(await repairBaseDataKitchenware(db,1,'recipe-1','rc7',required),false);
    await db.query(`UPDATE recipes SET required_kitchenware_json='[{"name":"管理员修改"}]' WHERE id=2`);
    assert.equal(await repairBaseDataKitchenware(db,2,'recipe-2','rc7',required),false);
    await db.query(`INSERT INTO recipe_kitchenware_requirements VALUES(3,30,'required','admin',1,'已审核')`);
    assert.equal(await repairBaseDataKitchenware(db,3,'recipe-3','rc7',required),false);
    assert.equal(await repairBaseDataKitchenware(db,4,'wrong-logical-id','rc7',required),false);
    assert.equal((await db.query('SELECT count(*) FROM recipe_kitchenware_requirements')).rows[0].count,'3');
    await db.query('SAVEPOINT failed_repair');
    const invalid = [{ catalog_id: 10,name: '蒸锅' },{ catalog_id: -1,name: '无效' }];
    await db.query('UPDATE recipes SET required_kitchenware_json=$1::jsonb WHERE id=4',[JSON.stringify(invalid.map(({catalog_id}) => ({catalog_id})))]);
    await assert.rejects(repairBaseDataKitchenware(db,4,'recipe-4','rc7',invalid));
    await db.query('ROLLBACK TO SAVEPOINT failed_repair');
    assert.equal((await db.query('SELECT count(*) FROM recipe_kitchenware_requirements WHERE recipe_id=4')).rows[0].count,'0');
    assert.deepEqual((await db.query('SELECT required_kitchenware_json FROM recipes WHERE id=4')).rows[0].required_kitchenware_json,legacy);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
