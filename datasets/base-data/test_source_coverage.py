import copy
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

from source_coverage import ARCHIVE, EVIDENCE, TFDA_EVIDENCE, audit, read_package, review_inventory, with_supplement


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

    def test_review_inventory_covers_current_records_without_promoting_complete_rows(self):
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(inventory, review_inventory(self.data, self.evidence, self.tfda_evidence))
        self.assertEqual(inventory['base_archive_sha256'], self.data['archive_sha256'])
        self.assertEqual(inventory['counts'], {'catalogue_concept': 1340, 'ingredient_form': 984,
                                              'recipe_concept': 1115, 'recipe_method': 389, 'nutrition_profile': 31})
        self.assertFalse(inventory['semantic_approval'])
        for row in inventory['records']:
            self.assertEqual(row['disposition'], 'pending_evidence')
            self.assertFalse(row['automatic_execution_allowed'])
            self.assertTrue(row['missing_or_unverified'])
            encoded = json.dumps(row['record'], ensure_ascii=False, sort_keys=True,
                                 separators=(',', ':'), allow_nan=False).encode()
            self.assertEqual(row['record_sha256'], hashlib.sha256(encoded).hexdigest())
        complete = next(r for r in inventory['records'] if r['kind'] == 'recipe_method'
                        and not r['record']['missing_fields'])
        self.assertIn('kitchen_execution_review', complete['missing_or_unverified'])
        self.assertEqual(inventory['gap_counts']['recipe_method_missing'],
                         sum(not r['method_ids'] for r in self.data['catalogue']['recipe-concepts']))

    def test_review_inventory_preserves_missing_evidence_and_rejects_contradictions(self):
        inventory = review_inventory(self.data)
        self.assertEqual(inventory['gap_counts']['source_observations_missing'], 5)
        data = copy.deepcopy(self.data)
        data['catalogue']['methods'].append(data['catalogue']['methods'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate review identity'):
            review_inventory(data)
        evidence = copy.deepcopy(self.tfda_evidence)
        evidence['records'][0]['source_position'] += 1
        with self.assertRaisesRegex(ValueError, 'Source observation position mismatch'):
            review_inventory(self.data, self.evidence, evidence)
        supplement = ARCHIVE.with_name('concept-enrichment-2026-10-03.1.zip')
        enriched = with_supplement(self.data, supplement)
        self.assertEqual(review_inventory(enriched, self.evidence, self.tfda_evidence)['supplement_sha256'],
                         hashlib.sha256(supplement.read_bytes()).hexdigest())

    def test_review_cli_creates_reproducible_artifact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'review.json'
            summary = Path(directory) / 'summary.json'
            command = [sys.executable, str(Path(__file__).with_name('source_coverage.py')),
                       '--review-output', str(output), '--output', str(summary)]
            subprocess.run(command, check=True, capture_output=True)
            before = output.read_bytes()
            expected = review_inventory(self.data, self.evidence, self.tfda_evidence)
            self.assertEqual(json.loads(before), expected)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            collision = Path(directory) / 'collision.json'
            result = subprocess.run(command[:2] + ['--review-output', str(collision), '--output', str(collision)],
                                    capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(collision.exists())

    def test_existing_documentary_evidence_is_attached_without_approval(self):
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(inventory['supporting_document_counts'], {
            'recipe-weighing-contracts': 20, 'equipment-role-updates': 18,
            'duplicate-review': 11, 'matching-decisions': 5})
        methods = [r for r in inventory['records'] if r['kind'] == 'recipe_method']
        self.assertEqual(sum(any(e['document'].endswith('recipe-weighing-contracts.json')
                                 for e in r['supporting_evidence']) for r in methods), 20)
        soy = next(r for r in inventory['records'] if r['id'] == 'FORM:DDD-I-soy')
        decision = soy['supporting_evidence'][0]['record']
        self.assertEqual(decision['source_food_id'], 'TFDA:P0700401')
        self.assertEqual(decision['status'], 'not_bound')
        for row in inventory['records']:
            self.assertFalse(row['automatic_execution_allowed'])
            for evidence in row['supporting_evidence']:
                self.assertFalse(evidence['semantic_approval'])
                document = evidence['document'].removeprefix('data/nutrition/').removesuffix('.json')
                self.assertEqual(evidence['record'], self.data[document][evidence['record_index']])
        expanded = with_supplement(self.data, ARCHIVE.with_name('concept-enrichment-2026-10-03.1.zip'))
        self.assertEqual(review_inventory(expanded, self.evidence, self.tfda_evidence)['supporting_document_counts'],
                         inventory['supporting_document_counts'])

    def test_stale_or_cross_record_supporting_evidence_is_rejected(self):
        cases = [('recipe-weighing-contracts', 'original_recipe_sha256', '0' * 64),
                 ('recipe-weighing-contracts', 'method_id', 'missing'),
                 ('equipment-role-updates', 'concept_id', 'missing'),
                 ('equipment-role-updates', 'evidence', [{'step': 2, 'text': 'unrelated step'}]),
                 ('matching-decisions', 'status', 'approved'),
                 ('matching-decisions', 'source_name', 'wrong sample'),
                 ('duplicate-review', 'concept_ids', ['missing', 'missing2'])]
        for document, key, value in cases:
            data = copy.deepcopy(self.data)
            data[document][0][key] = value
            with self.subTest(document=document, key=key), self.assertRaises(ValueError):
                review_inventory(data, self.evidence, self.tfda_evidence)
        data = copy.deepcopy(self.data)
        data['matching-decisions'].append(data['matching-decisions'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate supporting evidence'):
            review_inventory(data, self.evidence, self.tfda_evidence)


if __name__ == '__main__':
    unittest.main()
