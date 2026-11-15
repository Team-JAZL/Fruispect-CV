# Read saved research tables and figure catalogs for the dashboard.
import csv
import json


# Read a research JSON artifact while collecting missing-file diagnostics.
def read_json(path, missing):
    if not path.is_file():
        missing.append(str(path.name))
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, OSError) as exc:
        missing.append(f'{path.name}: {exc}')
        return None


# Assemble saved model metrics, experiment metadata, and research provenance.
def summary(artifacts):
    missing = []
    # Read a named research CSV table and record unavailable data.
    def table(name):
        path = artifacts / 'tables' / name
        if not path.is_file():
            missing.append('tables/' + name)
            return []
        try:
            with path.open(encoding='utf-8-sig', newline='') as stream:
                return list(csv.DictReader(stream))
        except (OSError, ValueError) as exc:
            missing.append(f'{name}: {exc}')
            return []
    return {'provenance': 'Held-out Test', 'metrics_source': 'tables/table_01_primary_model_comparison.csv',
            'models': table('table_01_primary_model_comparison.csv'),
            'stress': {'provenance': 'Controlled Stress Test', 'source': 'tables/table_09_controlled_stress_tests.csv',
                       'rows': table('table_09_controlled_stress_tests.csv')},
            'quality_by_fruit': table('table_03_quality_by_fruit.csv'),
            'manifest': read_json(artifacts / 'experiment_manifest.json', missing),
            'training_versions': read_json(artifacts / 'versions.json', missing), 'unavailable': missing}


# Validate cataloged figure paths and expose existing research PNG and PDF files.
def figures(artifacts):
    missing = []
    catalog = read_json(artifacts / 'figure_catalog.json', missing) or []
    rows = []
    for entry in catalog:
        item = {key: entry.get(key) for key in ('figure', 'slug', 'title', 'note')}
        item['provenance'] = 'Controlled Stress Test' if entry.get('slug') == 'stress_joint' else 'Saved Research Artifact'
        for ext in ('png', 'pdf'):
            relative = entry.get(ext, '')
            path = (artifacts / relative).resolve()
            item[ext] = f'/api/evaluation/artifact/{relative}' if relative and path.is_relative_to((artifacts / 'figures').resolve()) and path.is_file() else None
        rows.append(item)
    return {'figures': rows, 'unavailable': missing}
