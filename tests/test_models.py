import io
import numpy as np
import pytest
import torch
from PIL import Image, ImageOps
from app.core.preprocessing import metadata, decode, canonical_pixels, tensor_from_pixels
from app.core.model_adapter import ModelAdapter
from scripts.audit_artifacts import audit


@pytest.mark.models
def test_real_checkpoints_reference_parity(cfg):
    report=audit(cfg)
    assert not report['missing']
    assert len(report['models'])==3
    assert all(m['ready'] for m in report['models']),report['models']
    assert all(m['parity_max_abs_probabilities']<=1e-6 for m in report['models'])


def test_exif_small_alpha_and_determinism(cfg):
    data,_=metadata(cfg.artifacts)
    image=Image.new('RGBA',(12,30),(255,10,40,0))
    pixels=canonical_pixels(image,data)
    assert pixels.getpixel((0,0))==(128,128,128)
    assert pixels.getpixel((112,112))==(255,10,40)  # exact reference alpha discard
    assert np.sum(np.any(np.array(pixels)!=128,axis=2))==12*30  # no upscaling
    torch.testing.assert_close(tensor_from_pixels(pixels,data),tensor_from_pixels(canonical_pixels(image,data),data),rtol=0,atol=0)
    raw=io.BytesIO();exif=Image.Exif();exif[274]=6
    Image.new('RGB',(20,10)).save(raw,format='JPEG',exif=exif);raw.seek(0)
    corrected=decode(raw,1000)
    assert corrected.size==(10,20) and not corrected.getexif()


@pytest.mark.models
def test_input_preprocessing_hash_must_match_loaded_checkpoint(cfg):
    adapter=ModelAdapter('mobilenet_v3_small',cfg)
    with pytest.raises(ValueError,match='preprocessing hash'):
        adapter.predict(cfg.instance/'unread-input.png',preprocessing_hash='mismatched-input')
