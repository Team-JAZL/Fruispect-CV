# Initialize SQLite storage and manage explicit read and write connections.
from pathlib import Path
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from app.config import MODELS


# Format a timestamp as an ISO 8601 UTC value.
def iso(timestamp=None):
    return datetime.fromtimestamp(timestamp if timestamp is not None else time.time(), timezone.utc).isoformat()


class Database:
    # Initialize the component and its required dependencies.
    def __init__(self, path):
        self.path = path

    # Open a database connection and commit or roll back explicit writes.
    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=15000')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    # Create the database schema and register the configured model lanes.
    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))
            for key, name in MODELS.items():
                db.execute("INSERT OR IGNORE INTO model_registry(model_key,display_name,state) VALUES(?,?,'OFFLINE')", (key, name))
