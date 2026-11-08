import hashlib
import importlib.util
import platform
import sys
import time
import torch
import torchvision
from PIL import Image
from app.config import MODELS, FRUITS, QUALITIES
from app.core.preprocessing import metadata, tensor_from_pixels


def reference_module(artifacts):
    spec = importlib.util.spec_from_file_location('fruispect_saved_reference', artifacts / 'fruispect_inference.py')
    module = importlib.util.module_from_spec(spec)
    # Preserve research artifacts, including avoiding new bytecode cache files.
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


class ModelAdapter:
    def __init__(self, key, settings):
        self.key = key
        self.data, self.preprocessing_hash = metadata(settings.artifacts)
        self.path = settings.artifacts / 'models' / f'{key}.pth'
        with self.path.open('rb') as stream:
            self.checkpoint_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        checkpoint = torch.load(self.path, map_location='cpu', weights_only=True)
        expected = {'format_version', 'architecture', 'state_dict', 'preprocessing', 'seed', 'best_epoch', 'validation_selection', 'versions'}
        if set(checkpoint) != expected or checkpoint['format_version'] != 1 or checkpoint['architecture'] != key:
            raise ValueError('Unsupported checkpoint wrapper or architecture.')
        if checkpoint['preprocessing'] != self.data:
            raise ValueError('Checkpoint preprocessing differs from preprocessing.json.')
        torch.set_num_threads(settings.threads)
        self.device = torch.device(settings.device)
        if self.device.type == 'cuda' and not torch.cuda.is_available():
            raise ValueError('CUDA requested but unavailable. Select FRUISPECT_DEVICE=cpu.')
        self.model = reference_module(settings.artifacts).MultiTaskFruitCNN(key)
        self.model.load_state_dict(checkpoint['state_dict'], strict=True)
        self.model.to(self.device).eval()
        with torch.inference_mode():
            outputs = self.model(torch.zeros(1, 3, self.data['size'], self.data['size'], device=self.device))
        self.validate(outputs)
        self.info = {'model_key': key, 'architecture': MODELS[key], 'checkpoint_sha256': self.checkpoint_hash,
                     'preprocessing_sha256': self.preprocessing_hash, 'device': str(self.device),
                     'framework_versions': {'python': platform.python_version(), 'torch': torch.__version__, 'torchvision': torchvision.__version__},
                     'seed': checkpoint['seed'], 'best_epoch': checkpoint['best_epoch'],
                     'state_dict_tensors': len(checkpoint['state_dict']),
                     'parameters': sum(p.numel() for p in self.model.parameters()),
                     'smoke_shapes': [list(t.shape) for t in outputs]}

    @staticmethod
    def validate(outputs):
        if len(outputs) != 2 or tuple(outputs[0].shape) != (1, 6) or tuple(outputs[1].shape) != (1, 2):
            raise ValueError('Invalid dual-head output shapes.')
        if not all(torch.isfinite(t).all().item() for t in outputs):
            raise ValueError('Nonfinite logits.')

    def predict(self, canonical_path, preprocessing_hash=None):
        if preprocessing_hash is not None and preprocessing_hash != self.preprocessing_hash:
            raise ValueError('Admitted input preprocessing hash differs from the loaded checkpoint. Restart after restoring research metadata.')
        with Image.open(canonical_path) as image:
            batch = tensor_from_pixels(image, self.data).to(self.device)
        if self.device.type == 'cuda':
            torch.cuda.synchronize(self.device)
        start = time.perf_counter()
        with torch.inference_mode():
            outputs = self.model(batch)
        if self.device.type == 'cuda':
            torch.cuda.synchronize(self.device)
        duration = (time.perf_counter() - start) * 1000
        self.validate(outputs)
        fruit, quality = [t.softmax(1)[0].cpu().tolist() for t in outputs]
        f, q = max(range(6), key=fruit.__getitem__), max(range(2), key=quality.__getitem__)
        return {**self.info, 'predicted_fruit': FRUITS[f], 'fruit_class_index': f, 'fruit_confidence': fruit[f],
                'predicted_quality': QUALITIES[q], 'quality_class_index': q, 'quality_confidence': quality[q],
                'fruit_probabilities': dict(zip(FRUITS, fruit)), 'quality_probabilities': dict(zip(QUALITIES, quality)),
                'inference_ms': duration}
