"""Strict checkpoint smoke tests and parity against the preserved research helper."""
import argparse
import hashlib
import json
import platform
import tempfile
from pathlib import Path
import numpy as np
import torch
from PIL import Image
from app.config import MODELS, Settings
from app.core.model_adapter import ModelAdapter, reference_module
from app.core.preprocessing import canonical_pixels, metadata, tensor_from_pixels
from app.storage.database import iso


def audit(cfg):
    report = {'audited_at': iso(), 'host': platform.platform(), 'models': [], 'missing': [],
              'fixtures': 'Deterministic RGB, RGBA, grayscale, small images; no labeled photo accuracy claimed.',
              'artifact_hashes': {}}
    for name in ('fruispect_inference.py', 'preprocessing.json', 'experiment_manifest.json', 'versions.json',
                 'figure_catalog.json', 'split_manifest.csv', 'figures', 'runs', 'tables'):
        if not (cfg.artifacts / name).exists():
            report['missing'].append(name)
    for path in sorted(cfg.artifacts.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            with path.open('rb') as stream:
                report['artifact_hashes'][path.relative_to(cfg.artifacts).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
    data, prep_hash = metadata(cfg.artifacts)
    report['preprocessing'] = data
    report['preprocessing_sha256'] = prep_hash
    reference = reference_module(cfg.artifacts)
    generator = np.random.default_rng(250)
    fixtures = [Image.fromarray(generator.integers(0, 256, (311, 517, 3), dtype=np.uint8)),
                Image.fromarray(generator.integers(0, 256, (481, 197, 4), dtype=np.uint8)),
                Image.fromarray(generator.integers(0, 256, (41, 31), dtype=np.uint8))]
    with tempfile.TemporaryDirectory() as directory:
        for key in MODELS:
            try:
                adapter = ModelAdapter(key, cfg)
                original, original_data, device = reference.load_fruispect_model(adapter.path, device=cfg.device)
                max_logits = max_probs = 0.0
                for index, fixture in enumerate(fixtures):
                    pixels = canonical_pixels(fixture, data)
                    batch = tensor_from_pixels(pixels, data).to(device)
                    with torch.inference_mode():
                        new_logits = adapter.model(batch)
                        old_logits = original(batch)
                    for new, old in zip(new_logits, old_logits):
                        torch.testing.assert_close(new, old, rtol=1e-5, atol=1e-6)
                        max_logits = max(max_logits, (new-old).abs().max().item())
                    path = Path(directory) / f'{index}.png'
                    pixels.save(path)
                    actual = adapter.predict(path)
                    expected = reference.predict_fruispect_image(original, original_data, device, fixture)
                    for field, ref_field in [('fruit_probabilities','fruit_confidences'),('quality_probabilities','quality_confidences')]:
                        a, b = list(actual[field].values()), list(expected[ref_field].values())
                        np.testing.assert_allclose(a, b, rtol=1e-5, atol=1e-6)
                        max_probs = max(max_probs, float(np.max(np.abs(np.array(a)-np.array(b)))))
                report['models'].append({**adapter.info, 'ready': True, 'parity_max_abs_logits': max_logits,
                                         'parity_max_abs_probabilities': max_probs, 'parity_fixtures': len(fixtures)})
                del original, adapter
            except Exception as exc:
                report['models'].append({'model_key': key, 'ready': False, 'error': str(exc)})
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = audit(Settings.from_env())
    content = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k != 'artifact_hashes'}, indent=2))
    if not all(model['ready'] for model in report['models']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
