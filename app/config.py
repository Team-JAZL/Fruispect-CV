# Define model labels and load validated application settings.
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = {'resnet18': 'ResNet-18', 'mobilenet_v3_small': 'MobileNetV3-Small', 'efficientnet_b0': 'EfficientNet-B0'}
FRUITS = ['Apple', 'Banana', 'Guava', 'Lime', 'Orange', 'Pomegranate']
QUALITIES = ['Good', 'Bad']


@dataclass(frozen=True)
class Settings:
    instance: Path = ROOT / 'instance'
    artifacts: Path = ROOT / 'trained-outputs'
    device: str = 'cpu'
    threads: int = 2
    max_file_bytes: int = 12 * 1024 * 1024
    max_pixels: int = 24_000_000
    max_batch: int = 1000
    max_queue: int = 1500
    max_spool_bytes: int = 2 * 1024 ** 3
    upload_slots: int = 2
    retention_hours: float = 24
    lease_seconds: float = 30
    max_attempts: int = 3
    allow_lan: bool = False
    access_token: str = ''
    ngrok_enabled: bool = True
    ngrok_path: str = ''
    ngrok_timeout: float = 20

    # Return the configured private SQLite database path.
    @property
    def database(self):
        return self.instance / 'fruispect.sqlite3'

    # Return the configured private image spool directory.
    @property
    def spool(self):
        return self.instance / 'spool'

    # Load environment overrides and validate network access requirements.
    @classmethod
    def from_env(cls):
        # Read and cast an environment setting with its default value.
        def val(name, default, cast=int):
            return cast(os.environ.get('FRUISPECT_' + name, default))
        host = os.environ.get('FRUISPECT_HOST', '127.0.0.1')
        token = os.environ.get('FRUISPECT_ACCESS_TOKEN', '')
        lan = host not in ('127.0.0.1', 'localhost', '::1')
        if lan and len(token) < 20:
            raise ValueError('LAN binding requires FRUISPECT_ACCESS_TOKEN of at least 20 characters and HTTPS proxy.')
        return cls(instance=Path(os.environ.get('FRUISPECT_INSTANCE', ROOT / 'instance')).resolve(),
                   artifacts=Path(os.environ.get('FRUISPECT_ARTIFACTS', ROOT / 'trained-outputs')).resolve(),
                   device=os.environ.get('FRUISPECT_DEVICE', 'cpu'), threads=val('THREADS', 2),
                   max_file_bytes=val('MAX_FILE_MB', 12) * 1024 ** 2, max_pixels=val('MAX_PIXELS', 24_000_000),
                   max_batch=val('MAX_BATCH', 1000), max_queue=val('MAX_QUEUE', 1500),
                   max_spool_bytes=val('MAX_SPOOL_MB', 2048) * 1024 ** 2, upload_slots=val('UPLOAD_SLOTS', 2),
                   retention_hours=val('RETENTION_HOURS', 24, float), access_token=token, allow_lan=lan,
                   ngrok_enabled=os.environ.get('FRUISPECT_NGROK', 'auto').lower() not in ('0', 'off', 'false'),
                   ngrok_path=os.environ.get('FRUISPECT_NGROK_PATH', '').strip('"'),
                   ngrok_timeout=val('NGROK_TIMEOUT', 20, float))
