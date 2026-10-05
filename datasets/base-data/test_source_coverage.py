import copy
import hashlib
import json
from pathlib import Path
import unittest

from source_coverage import ARCHIVE, EVIDENCE, TFDA_EVIDENCE, audit, read_package


class SourceCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = read_package(ARCHIVE)
        cls.evidence = json.loads(EVIDENCE.read_text(encoding='utf8'))
        cls.tfda_evidence = json.loads(TFDA_EVIDENCE.read_text(encoding='utf8'))

    def test_shipped_evidence_and_report_are_reproducible(self):
        self.assertEqual(hashlib.sha256(EVIDENCE.read_bytes()).hexdigest(),
                         '1c00265e1191de69017154d6d14ede20301100a7a852f7949fdc9a794424250a')
        self.assertEqual(hashlib.sha256(TFDA_EVIDENCE.read_bytes()).hexdigest(),
                         'a1b005fb463138f7d4c861bb77fc3a853804e8b122525b218fefde641992d36e')
        report = audit(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(report, json.loads(Path(__file__).with_name('source-coverage.json').read_text(encoding='utf8')))
        self.assertEqual(report['ingredient_concepts'], 1079)
        self.assertEqual(report['recipe_concepts_with_methods'], 385)
        self.assertEqual(report['profiles_with_checked_source_observations'], 31)
        self.assertEqual(len(report['profiles_missing_source_observations']), 0)
        self.assertEqual(report['recipes_with_four_core_nutrients_per_serving'], 8)
        self.assertEqual(report['nutrition_gap_priority'][0]['ingredient'], '生抽酱油')
        self.assertEqual(report['nutrition_gap_priority'][0]['affected_recipe_count'], 5)

    def test_missing_evidence_is_reported_not_inferred_from_a_link(self):
        report = audit(self.data)
        self.assertEqual(report['profiles_with_checked_source_observations'], 26)
        self.assertIn('USDA-FDC-2646170', [p['source_food_id'] for p in report['profiles_missing_source_observations']])
        self.assertEqual(len(audit(self.data, self.evidence)['profiles_missing_source_observations']), 4)

    def test_restored_tfda_observation_must_match_its_exact_source_position(self):
        evidence = copy.deepcopy(self.tfda_evidence)
        evidence['records'][0]['source_position'] += 1
        with self.assertRaisesRegex(ValueError, 'Source observation position mismatch'):
            audit(self.data, self.evidence, evidence)

    def test_changed_observation_or_unit_cannot_pass_even_with_consistent_estimates(self):
        for field, value in [('amount', '999'), ('fdc_id', 'wrong')]:
            data = copy.deepcopy(self.data)
            record = data['source-selected-records'][0]
            profile = next(p for p in data['nutrition-profiles'] if p['source_food_id'] == 'USDA-FDC-' + record['food']['fdc_id'])
            row = next(n for n in record['food_nutrient'] if n['id'] == profile['nutrients_per_100g']['protein']['observation_id'])
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                audit(data, self.evidence)
        evidence = copy.deepcopy(self.evidence)
        next(n for n in evidence['food']['foodNutrients'] if n['nutrient']['id'] == 1003)['nutrient']['unitName'] = 'mg'
        with self.assertRaises(ValueError):
            audit(self.data, evidence)

    def test_missing_values_do_not_pass_as_zero_or_recipe_totals(self):
        data = copy.deepcopy(self.data)
        vinegar = next(p for p in data['nutrition-profiles'] if p['source_food_id'] == 'TFDA:P0600101')
        vinegar['nutrients_per_100g']['protein']['amount'] = 0
        with self.assertRaises(ValueError):
            audit(data, self.evidence)
        data = copy.deepcopy(self.data)
        complete = next(r for r in data['recipe-nutrition'] if r['per_serving'])
        complete['per_serving']['calories'] += 1
        with self.assertRaises(ValueError):
            audit(data, self.evidence)

    def test_relabeling_protein_as_fat_is_not_valid_source_evidence(self):
        for source_kind in ('SR_Legacy', 'Foundation_Foods'):
            data = copy.deepcopy(self.data)
            profile = next(p for p in data['nutrition-profiles'] if p['source_kind'] == source_kind)
            nutrients = profile['nutrients_per_100g']
            nutrients['protein'], nutrients['fat'] = nutrients['fat'], nutrients['protein']
            with self.subTest(source_kind=source_kind), self.assertRaisesRegex(ValueError, 'Nutrient definition mismatch'):
                audit(data, self.evidence)


if __name__ == '__main__':
    unittest.main()
