# Run real checkpoint predictions for a supplied image from the command line.
import argparse
import json
import tempfile
from pathlib import Path
from app.config import Settings, MODELS
from app.inference.adapter import ModelAdapter
from app.inference.preprocessing import decode, metadata, canonical_pixels


# Run the predict command with configured arguments.
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    parser.add_argument('--model', choices=list(MODELS), action='append')
    args = parser.parse_args()
    cfg = Settings.from_env()
    image = decode(args.image, cfg.max_pixels)
    data, _ = metadata(cfg.artifacts)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'canonical.png'
        canonical_pixels(image, data).save(path)
        for key in args.model or MODELS:
            print(json.dumps(ModelAdapter(key, cfg).predict(path), indent=2))


if __name__ == '__main__':
    main()
