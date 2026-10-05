"""Audit the shipped data, source observations and recipe gaps without a database."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import zipfile

from reclean.enrich_core import CORE, estimate, scalar

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'datasets/releases/system-data-2026-09-15.2.zip'
EVIDENCE = Path(__file__).with_name('evidence') / 'usda-foundation-2646170.json'
TFDA_EVIDENCE = Path(__file__).with_name('evidence') / 'tfda-core-samples.json'
TFDA_NAMES = {'calories': '熱量', 'protein': '粗蛋白', 'fat': '粗脂肪', 'carbs': '總碳水化合物'}


def read_package(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive member')
        manifests = [name for name in names if name.count('/') == 1 and name.endswith('/manifest.json')]
        if len(manifests) != 1:
            raise ValueError('Expected one package manifest')
        root = manifests[0].removesuffix('manifest.json')
        manifest = json.loads(archive.read(manifests[0]))
        if set(names) != {root + name for name in manifest['files']} | {manifests[0]}:
            raise ValueError('Package manifest membership mismatch')
        for name, digest in manifest['files'].items():
            if hashlib.sha256(archive.read(root + name)).hexdigest() != digest:
                raise ValueError('Package checksum mismatch: ' + name)
        load = lambda name: json.loads(archive.read(root + 'data/' + name + '.json'))
        return {'version': manifest['version'], 'archive_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                'catalogue': load('runtime-input'),
                **{name: load('nutrition/' + name) for name in (
                    'nutrition-profiles', 'recipe-nutrition', 'recipe-inputs',
                    'source-selected-records', 'tfda-selected-records')}}


def with_supplement(data, path):
    """Overlay a manifest-checked references-only archive on its exact base catalogue."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        manifests = [n for n in names if n.count('/') == 1 and n.endswith('/manifest.json')]
        if len(manifests) != 1 or len(names) != len(set(names)):
            raise ValueError('Invalid supplement manifest')
        root = manifests[0].removesuffix('manifest.json')
        manifest = json.loads(archive.read(manifests[0]))
        if set(names) != {root + n for n in manifest} | {manifests[0]}:
            raise ValueError('Supplement manifest membership mismatch')
        for name, digest in manifest.items():
            if hashlib.sha256(archive.read(root + name)).hexdigest() != digest:
                raise ValueError('Supplement checksum mismatch: ' + name)
        load = lambda name: json.loads(archive.read(root + name + '.json'))
        if load('source.lock')['parent_archive_sha256'] != data['archive_sha256']:
            raise ValueError('Supplement base archive mismatch')
        summary = load('summary')
        if summary['import_mode'] != 'scoped_reference_additions':
            raise ValueError('Unexpected supplement mode')
        for key in ('recipe-inputs', 'recipe-nutrition'):
            if load(key) != data[key]:
                raise ValueError('References-only supplement changed recipes')
        profiles = load('nutrition-profiles')
        if profiles[:len(data['nutrition-profiles'])] != data['nutrition-profiles']:
            raise ValueError('References-only supplement changed existing profiles')
        return {**data, 'version': summary['version'], 'nutrition-profiles': profiles,
                'tfda-selected-records': load('tfda-selected-records'),
                'foundation-source-record': load('foundation-source-record')}


def verify_profile(profile, sr, tfda, foundation):
    """Return missing evidence; contradicting evidence fails instead of being hidden."""
    food_id = profile['source_food_id']
    if not profile.get('source_url') or not profile.get('source_license'):
        raise ValueError('Missing source attribution: ' + food_id)
    for key, (nutrient_id, unit) in CORE.items():
        nutrient = profile['nutrients_per_100g'][key]
        allowed_ids = {'1008', '2047', '2048'} if key == 'calories' else {nutrient_id}
        if nutrient['unit'] != unit or (profile['source_kind'] in {'SR_Legacy', 'Foundation_Foods'}
                                      and nutrient.get('nutrient_id') not in allowed_ids):
            raise ValueError(f'Nutrient definition mismatch: {food_id} / {key}')
    observations = {}
    if profile['source_kind'] == 'SR_Legacy' and food_id in sr:
        record = sr[food_id]
        if record['food']['description'] != profile['source_name']:
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, nutrient in profile['nutrients_per_100g'].items():
            rows = [row for row in record['food_nutrient'] if row['nutrient_id'] == nutrient['nutrient_id']]
            if len(rows) != 1 or rows[0]['id'] != nutrient['observation_id'] or rows[0]['fdc_id'] != record['food']['fdc_id']:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            observations[key] = (rows[0]['amount'], record['nutrient_definitions'][nutrient['nutrient_id']]['unit_name'])
    elif profile['source_kind'] == 'TFDA' and food_id in tfda:
        rows = tfda[food_id]
        if any(row['row']['樣品名稱'] != profile['source_name'] for row in rows):
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, name in TFDA_NAMES.items():
            selected = [row for row in rows if row['row']['分析項'] == name]
            if len(selected) != 1:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            row = selected[0]
            if profile['nutrients_per_100g'][key]['observation_id'] != f"TFDA-OBS:{food_id[5:]}:{row['source_position']}":
                raise ValueError('Source observation position mismatch: ' + food_id)
            observations[key] = (row['row']['每100克含量'], row['row']['含量單位'])
    elif profile['source_kind'] == 'Foundation_Foods' and food_id in foundation:
        food = foundation[food_id]
        if food['description'] != profile['source_name'] or food['dataType'] != 'Foundation':
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, nutrient in profile['nutrients_per_100g'].items():
            rows = [row for row in food['foodNutrients'] if str(row['nutrient']['id']) == nutrient['nutrient_id']]
            if len(rows) != 1:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            observations[key] = (rows[0].get('amount'), rows[0]['nutrient']['unitName'])
    else:
        return False
    for key in CORE:
        amount, unit = observations[key]
        nutrient = profile['nutrients_per_100g'][key]
        if unit.lower() != nutrient['unit'].lower() or scalar(amount) != nutrient['amount']:
            raise ValueError(f'Source nutrient mismatch: {food_id} / {key}')
    return True


def audit(data, evidence=None, tfda_evidence=None):
    catalogue, profiles = data['catalogue'], data['nutrition-profiles']
    if len({p['id'] for p in profiles}) != len(profiles):
        raise ValueError('Duplicate profile identity')
    forms = {f['id']: f for f in catalogue['ingredient-forms']}
    for profile in profiles:
        form = forms.get(profile['ingredient_form_id'])
        if not form or form['concept_id'] != profile['ingredient_concept_id']:
            raise ValueError('Profile form/concept mismatch')
    sr = {'USDA-FDC-' + row['food']['fdc_id']: row for row in data['source-selected-records']}
    tfda = defaultdict(list)
    positions = {}
    for row in data['tfda-selected-records'] + (tfda_evidence or {}).get('records', []):
        if row['source_position'] in positions:
            if positions[row['source_position']] != row:
                raise ValueError('Source observation position mismatch: conflicting TFDA rows')
            continue
        positions[row['source_position']] = row
        tfda['TFDA:' + row['row']['整合編號']].append(row)
    evidence = evidence or data.get('foundation-source-record')
    foundation = {} if evidence is None else {'USDA-FDC-' + str(evidence['food']['fdcId']): evidence['food']}
    missing = []
    for profile in profiles:
        if not verify_profile(profile, sr, tfda, foundation):
            missing.append({key: profile[key] for key in ('display_name', 'source_food_id', 'source_url')})
    methods = {method['id']: method for method in data['recipe-inputs']}
    blockers = defaultdict(lambda: {'recipes': set(), 'reasons': set()})
    for recipe in data['recipe-nutrition']:
        calculated = estimate(methods[recipe['method_id']], recipe['selections'], profiles)
        for key in ('whole_recipe', 'per_serving', 'known_subtotal', 'coverage', 'status'):
            if calculated[key] != recipe[key]:
                raise ValueError(f'Recipe calculation mismatch: {recipe["method_id"]} / {key}')
        for gap in recipe['gaps']:
            blockers[gap['name']]['recipes'].add(recipe['title'])
            blockers[gap['name']]['reasons'].add(gap.get('reason_text', gap['reason']))
    ingredients = [c for c in catalogue['concepts'] if c['active_catalogue'] and
                   (c['kind'] == 'ingredient' or 'ingredient' in c.get('application_roles', []))]
    covered = {profile['ingredient_concept_id'] for profile in profiles}
    if not covered <= {c['id'] for c in ingredients}:
        raise ValueError('Nutrition reference points outside ingredient catalogue')
    return {
        'package_version': data['version'],
        'ingredient_concepts': len(ingredients),
        'concepts_with_scoped_nutrition_reference': len(covered),
        'concepts_without_scoped_nutrition_reference': len(ingredients) - len(covered),
        'nutrition_profiles': len(profiles),
        'profiles_by_source': dict(sorted(Counter(p['source_kind'] for p in profiles).items())),
        'profiles_with_checked_source_observations': len(profiles) - len(missing),
        'profiles_missing_source_observations': missing,
        'recipe_concepts_with_methods': sum(bool(r['method_ids']) for r in catalogue['recipe-concepts']),
        'dish_concepts_without_recipe_method': sum(not r['method_ids'] for r in catalogue['recipe-concepts']),
        'recipe_methods': len(catalogue['methods']),
        'recipe_methods_with_source_url': sum(bool(m['source'].get('source_url')) for m in catalogue['methods']),
        'recipe_methods_with_declared_license': sum(bool(m['source'].get('source_license')) for m in catalogue['methods']),
        'recipe_methods_with_nutrition_assessment': len(data['recipe-nutrition']),
        'recipes_with_four_core_nutrients_per_serving': sum(r['per_serving'] is not None for r in data['recipe-nutrition']),
        'recipe_method_missing_fields': dict(sorted(Counter(f for m in catalogue['methods'] for f in m['missing_fields']).items())),
        'nutrition_gap_priority': [{'ingredient': name, 'affected_recipe_count': len(value['recipes']),
            'recipes': sorted(value['recipes']), 'reasons': sorted(value['reasons'])}
            for name, value in sorted(blockers.items(), key=lambda item: (-len(item[1]['recipes']), item[0]))],
        'scope': 'Frozen reference package only; source-value checks do not establish ingredient equivalence, professional review, cooking safety or live database state.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', nargs='?', type=Path, default=ARCHIVE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--enrichment', type=Path, help='Audit the base plus a references-only supplement ZIP')
    args = parser.parse_args()
    data = read_package(args.archive)
    if args.enrichment:
        data = with_supplement(data, args.enrichment)
    report = audit(data, json.loads(EVIDENCE.read_text(encoding='utf8')),
                   json.loads(TFDA_EVIDENCE.read_text(encoding='utf8')))
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
    if args.output:
        args.output.write_text(text, encoding='utf8')
    else:
        print(text, end='')
