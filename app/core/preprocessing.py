"""Exact evaluation pixels from the saved reference; no training augmentation."""
import hashlib
import json
import warnings
import numpy as np
from PIL import Image, ImageOps
from app.config import FRUITS, QUALITIES


def metadata(artifacts):
    raw = (artifacts / 'preprocessing.json').read_bytes()
    data = json.loads(raw)
    if (set(data) != {'size', 'mode', 'mean', 'std', 'fruit_classes', 'quality_classes'}
            or data['mode'] != 'RGB_letterbox_gray128' or data['size'] != 224
            or data['fruit_classes'] != FRUITS or data['quality_classes'] != QUALITIES
            or len(data['mean']) != 3 or len(data['std']) != 3
            or not np.isfinite(data['mean'] + data['std']).all() or min(data['std']) <= 0):
        raise ValueError('Unsupported preprocessing artifact; explicit integration required.')
    return data, hashlib.sha256(raw).hexdigest()


def decode(stream, max_pixels):
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(stream) as source:
            if source.format not in ('JPEG', 'PNG', 'WEBP'):
                raise ValueError('Only decoded JPEG, PNG, or WebP images are accepted.')
            if getattr(source, 'n_frames', 1) != 1:
                raise ValueError('Animated images are unsupported; submit a still image.')
            if source.width * source.height > max_pixels:
                raise ValueError(f'Image exceeds {max_pixels:,} decoded pixels.')
            source.load()
            # Match reference conversion: alpha is discarded, not composited.
            return ImageOps.exif_transpose(source).convert('RGB')


def canonical_pixels(image, data):
    image = ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail((data['size'], data['size']), Image.Resampling.BILINEAR)
    canvas = Image.new('RGB', (data['size'], data['size']), (128, 128, 128))
    canvas.paste(image, ((data['size'] - image.width) // 2, (data['size'] - image.height) // 2))
    return canvas


def tensor_from_pixels(image, data):
    import torch
    from torchvision.transforms import functional as F
    return F.normalize(F.to_tensor(image), data['mean'], data['std']).unsqueeze(0)
