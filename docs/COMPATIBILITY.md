# Checkpoint and preprocessing compatibility

The research bundle contains 133 files. Checkpoints and experiment data are preserved. The reference helper uses the same calculations with normalized file/function comments. [The current artifact audit](evidence/artifact-audit.json) records SHA-256 values and CPU parity tests.

## Observed format

Every `.pth` has exactly `format_version`, `architecture`, `state_dict`, `preprocessing`, `seed`, `best_epoch`, `validation_selection`, and `versions`. Version is 1. The adapter supports this observed wrapper explicitly, loads with `map_location='cpu', weights_only=True`, and refuses mismatched metadata. It imports the preserved trusted `MultiTaskFruitCNN` source rather than guessing architectures. No pretrained downloads or unsafe pickle fallback occur.

| Architecture | State tensors | Fruit head | Quality head | Parameters | Selected epoch |
| --- | ---: | --- | --- | ---: | ---: |
| ResNet-18 | 124 | 6 × 512 | 2 × 512 | 11,180,616 | 42 |
| MobileNetV3-Small | 244 | 6 × 576 | 2 × 576 | 931,624 | 27 |
| EfficientNet-B0 | 362 | 6 × 1280 | 2 × 1280 | 4,017,796 | 20 |

Constructors use `weights=None`, identity backbone classifiers, and parallel linear heads. All use recorded seed 42. Strict loading reported no missing/unexpected parameters. Evaluation-mode CPU smoke tests produced finite `[1,6]` and `[1,2]` logits.

| Artifact | SHA-256 |
| --- | --- |
| resnet18.pth | `db8b48e0c5da5ca43c816ac4b70330572180937f26b0d1699aed82223e87ac46` |
| mobilenet_v3_small.pth | `15e42053d99bf4e828d58fa446aca704bd219fd6b7b14ca43596606ebd0ad6da` |
| efficientnet_b0.pth | `a8114fe33316596d6f24069422bcdb77eff93fc17c7f5a715624095f8dba6231` |
| preprocessing.json | `b57042317c49ec77abba724e827d8da10ece5de00170af1930c11d5743404102` |

## Exact evaluation transform

The helper specifies EXIF transpose, `.convert('RGB')`, Pillow `thumbnail((224,224), BILINEAR)`, center on an RGB `(128,128,128)` canvas, ToTensor, Normalize. Thumbnail preserves aspect ratio and **does not upscale small images**. Alpha is discarded by RGB conversion, matching the reference. No crop or random augmentation is introduced. Canonical pixels are cached losslessly; workers apply identical tensor conversion/normalization.

- Mean: `[0.613960381786709, 0.5893228371499974, 0.5428700503561701]`
- Std: `[0.23108737294103834, 0.23770337010086348, 0.26708833246924285]`
- Fruit order: Apple, Banana, Guava, Lime, Orange, Pomegranate
- Quality order: Good, Bad

Embedded checkpoint preprocessing equals JSON. Missing/mismatching metadata prevents readiness instead of substituting normalization.

## Runtime and parity

Training records Python 3.13.16, PyTorch 2.11.0+cu130, TorchVision 0.26.0+cu130, NumPy 2.1.3, Linux, Tesla T4. Verified host: Windows 11, Python 3.14.5, PyTorch 2.13.0+cpu, TorchVision 0.28.0+cpu, NumPy 2.5.2, Pillow 12.3.0.

Adapter and original helper loaded separate model instances. Each model was checked with deterministic wide RGB, tall RGBA, and small grayscale fixtures. Logits on equivalent tensors and probabilities from the original image helper matched with maximum absolute differences **0.0** for both logits and probabilities. Assertions use rtol 1e-5, atol 1e-6. Additional tests cover EXIF orientation, alpha handling, no upscaling, and exact deterministic normalization.

## Available research and limits

The current Windows/Python 3.14 CPU verification covers all real checkpoints, the supervisor pipeline, and a browser upload through the modular frontend. Earlier integration was also checked on Python 3.12.10. See [verification](VERIFICATION.md) for current results.

Present: manifest, versions, preprocessing, split ledger, three checkpoints, helper, 31 figures in PNG/PDF, per-seed reports/history/test prediction CSVs, and class/summary/stress tables. Dashboard reads authentic CSV/catalog values. Original dataset photographs are absent; split paths refer to the Kaggle environment. No new photographic accuracy evaluation was performed. Saved evidence covers 1,200 held-out images, one seed per architecture, and controlled changes to those images; it does not establish camera-domain accuracy or across-run variability. CUDA was not verified on this CPU-only host.
