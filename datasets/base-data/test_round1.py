"""Regression checks for first-round data completion."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from reclean import round1_parser as r
from reclean import round1 as builder
from reclean import package as pkg

BASELINE = Path(os.environ.get('DDD_BASE_DATA_ROUND1_BASELINE', Path(__file__).resolve().parents[2] / 'artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip'))


class ParserTests(unittest.TestCase):
    def setUp(self):
        ingredients = [dict(id=name, name=name, aliases=[]) for name in ('鸡蛋','蛋清','盐','油','水','黄油','玉米油','葱','姜','蒜','蚝油','青葱','玉米粒','青豆')]
        self.parser = r.Parser(ingredients, [dict(id='pan',name='平底锅',aliases=[])],
            dict(headings=['调料'], prepared_terms={}, bundles={'葱姜蒜':['葱','姜','蒜']}), dict(prepared_terms={}))

    def test_primary_count_is_not_replaced_by_parenthetical_weight(self):
        value = r.amount('2 个(约 100g)')
        self.assertEqual((value['value'], value['unit']), (2, '个'))
        self.assertEqual(value['additional_measurements'][0]['value'], 100)
        self.assertTrue(value['additional_measurements'][0]['approximate'])

    def test_amount_prefix_and_parentheses_do_not_corrupt_identity(self):
        for raw in ('鸡蛋 2 个（约 100g）', '2 个鸡蛋（约 100g）', '鸡蛋（可选）2 个'):
            item = self.parser.single(raw)
            self.assertEqual(item['ingredient_id'], '鸡蛋', raw)
            self.assertEqual(item['measurement']['value'], 2, raw)
            self.assertIsNone(item['quantity'])
        self.assertEqual(self.parser.single('盐的用量为:2g。')['quantity'], 2)

    def test_primary_unit_not_replaced_by_equality_reference(self):
        value = r.amount('1 块 = 10 克')
        self.assertEqual((value['value'], value['unit']), (1,'块'))
        self.assertEqual(value['additional_measurements'][0]['value'], 10)
        self.assertEqual(r.amount('70 x 5 = 350g')['value'], 350)
        self.assertTrue(r.amount('70 x 5 = 350g')['stated_result'])

    def test_fraction_does_not_disable_ingredient_choice(self):
        result = self.parser.parse('黄油或玉米油 ⅛ cup')
        self.assertEqual(result['kind'], 'choice')
        self.assertIsNone(result['items'][0]['ingredient_id'])
        self.assertEqual(result['items'][0]['ingredient_options'][1]['measurement']['value'], 0.125)
        self.assertEqual(r.amount('2½ cup')['value'], 2.5)

    def test_per_person_formula_is_not_a_choice(self):
        result = self.parser.parse('盐 5g/人')
        self.assertEqual(result['kind'], 'ingredient')
        self.assertEqual(result['items'][0]['measurement']['kind'], 'formula')
        self.assertIsNone(result['items'][0]['quantity'])

    def test_unknown_choice_never_selects_first_ingredient(self):
        result = self.parser.parse('黄油或其他油脂 20g')
        self.assertEqual(result['items'][0]['mapping_status'], 'choice_unresolved')
        self.assertIsNone(result['items'][0]['ingredient_id'])
        self.assertIsNone(result['items'][0]['quantity'])

    def test_shared_bundle_does_not_duplicate_total(self):
        result = self.parser.parse('葱姜蒜 50g')
        self.assertEqual(result['kind'], 'bundle')
        self.assertEqual(len(result['items']), 3)
        self.assertTrue(all(i['quantity'] is None and i['measurement']['value'] is None for i in result['items']))
        result = self.parser.parse('盐 3g、油 5ml')
        self.assertEqual([i['quantity'] for i in result['items']], [3,5])
        combined = self.parser.parse('玉米粒和青豆总共 30g')
        self.assertEqual(combined['kind'],'bundle')
        self.assertTrue(all(i['quantity'] is None for i in combined['items']))

    def test_bounded_quantity_and_part_qualifier_are_retained(self):
        value = r.amount('≥30 ml')
        self.assertEqual(value['kind'],'lower_bound')
        self.assertEqual(value['minimum'],30)
        self.assertIsNone(value['value'])
        item = self.parser.single('青葱，葱白，25g。')
        self.assertEqual(item['quantity'],25)
        self.assertIn('葱白',item['qualifiers'])

    def test_headings_equipment_and_unit_definitions_are_not_foods(self):
        self.assertEqual(self.parser.parse('调料')['kind'], 'heading')
        self.assertEqual(self.parser.parse('1 汤匙 = 15ml')['kind'], 'instruction')
        self.assertEqual(self.parser.parse('平底锅 1 个')['kind'], 'equipment')

    def test_optional_and_egg_part_survive_parsing(self):
        self.assertTrue(self.parser.single('[可选] 蚝油 3ml')['optional'])
        self.assertEqual(self.parser.single('一个鸡蛋的鸡蛋清')['ingredient_id'],'蛋清')
        value = r.amount('0-80g')
        self.assertEqual(value['kind'],'optional_range')
        self.assertIsNone(value['value'])

    def test_unknown_units_and_invalid_values_remain_unusable(self):
        for raw in ('0g','-5g','NaN g','1/0 g','2cm','适量','少许'):
            self.assertIsNone(r.amount(raw)['value'], raw)
        self.assertEqual(r.amount('2 斤')['unit'],'斤')


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ddd-round1-tests-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.archive, cls.report = builder.build(BASELINE, cls.root/'first')
        with zipfile.ZipFile(cls.archive) as z:
            cls.files = {name:z.read(name) for name in z.namelist()}
        cls.after = {name:json.loads(cls.files['clean/'+name+'.json']) for name in (
            'ingredients','recipes','kitchenware','initial-data','nutrition-foods','nutrition-observations')}
        cls.before = {name:json.loads(cls.files['upstream/rc1/clean/'+name+'.json']) for name in cls.after}
        cls.ledger = json.loads(cls.files['review/round1-original-unresolved-ledger.json'])

    def recipe(self,title):
        return next(r for r in self.after['recipes'] if r['title']==title and r['source']=='howtocook')

    def test_every_original_unresolved_line_is_accounted_for(self):
        self.assertEqual(len(self.ledger),712)
        self.assertEqual(len({x['id'] for x in self.ledger}),712)
        self.assertLess(self.report['unresolved_line_outcomes']['unresolved'],60)
        self.assertGreater(self.report['unresolved_line_outcomes']['ingredient_linked'],500)
        incomplete = self.ledger[:-1]
        with self.assertRaisesRegex(ValueError,'ledger is incomplete'):
            builder.validate(self.after,self.before,incomplete)

    def test_all_old_ids_and_out_of_scope_data_preserved(self):
        for name in ('ingredients','kitchenware','recipes'):
            self.assertLessEqual({r['id'] for r in self.before[name]},{r['id'] for r in self.after[name]})
        for name in ('initial-data','nutrition-foods','nutrition-observations'):
            self.assertEqual(self.before[name],self.after[name])
        self.assertEqual(len(self.after['recipes']),389)

    def test_new_catalogue_entries_have_actual_source_evidence(self):
        recipes = {r['id']:r for r in self.before['recipes']}
        for name in ('ingredients','kitchenware'):
            old = {r['id'] for r in self.before[name]}
            for row in self.after[name]:
                if row['id'] not in old:
                    self.assertTrue(row['name_evidence'])
                    for evidence in row['name_evidence']:
                        source = recipes[evidence['recipe_id']]
                        self.assertEqual(source[evidence['source_field']][evidence['position']]['source_text'],evidence['source_text'])
                        self.assertEqual(source['source_sha256'],evidence['source_sha256'])

    def test_step_supplements_and_conflicting_salt_are_distinct(self):
        fish = self.recipe('鱼香肉丝')
        water = next(i for i in fish['ingredients'] if i['name']=='水')
        self.assertEqual(water['quantity'],40)
        self.assertEqual(len(water['amount_provenance']['allocations']),2)
        salt = next(i for i in fish['ingredients'] if i['name']=='盐')
        self.assertEqual(salt['quantity'],5)
        self.assertTrue(fish['source_inconsistencies'])
        self.assertIn('source_quantity_inconsistency',fish['readiness']['blockers'])
        vegetable = self.recipe('水油焖蔬菜')
        oyster = next(i for i in vegetable['ingredients'] if i['name']=='蚝油')
        self.assertTrue(oyster['optional'])
        self.assertEqual(oyster['quantity'],3)

    def test_equipment_instructions_have_evidence(self):
        recipe = self.recipe('煎饺')
        explicit = [r for r in recipe['kitchenware_requirements'] if r['source_section']=='operation']
        self.assertEqual(len(explicit),2)
        self.assertTrue(all(r['role']=='required' for r in explicit))
        self.assertFalse(recipe['automatic_inventory_write_allowed'])

    def test_reproducible_package_and_self_contained_builder(self):
        second,_ = builder.build(BASELINE,self.root/'second')
        self.assertEqual(self.archive.read_bytes(),second.read_bytes())
        builder.verify(self.archive)
        extracted = self.root/'extracted'
        with zipfile.ZipFile(self.archive) as z:z.extractall(extracted)
        out = self.root/'self-contained'
        result = subprocess.run([sys.executable,str(extracted/'build/reclean/round1.py'),'--baseline',str(BASELINE.resolve()),'--output',str(out)],
                                capture_output=True,text=True,encoding='utf8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.archive.read_bytes(),(out/self.archive.name).read_bytes())

    def test_source_tampering_and_output_overwrite_rejected(self):
        bad = self.root/'bad.zip';bad.write_bytes(BASELINE.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'Baseline archive hash mismatch'):
            builder.build(bad,self.root/'bad-output')
        self.assertFalse((self.root/'bad-output').exists())
        with self.assertRaisesRegex(ValueError,'already exists'):
            builder.build(BASELINE,self.root/'first')

    def test_shared_amount_and_choice_cannot_be_silently_applied(self):
        changed = deepcopy(self.after)
        item = next(i for recipe in changed['recipes'] for i in recipe['ingredients'] if i.get('ingredient_options'))
        item['ingredient_id'] = item['ingredient_options'][0]['ingredient_id']
        recipe = next(recipe for recipe in changed['recipes'] if item in recipe['ingredients'])
        recipe['content_sha256'] = pkg.digest(pkg.encoded({k:v for k,v in recipe.items() if k!='content_sha256'}))
        with self.assertRaisesRegex(ValueError,'Choice silently selected'):
            builder.validate(changed,self.before,self.ledger)


if __name__ == '__main__':
    unittest.main()
