# Request graceful shutdown of the configured application instance.
from app.config import Settings
from app.storage.database import Database


# Run the stop command with configured arguments.
def main():
    cfg = Settings.from_env()
    if not cfg.database.is_file():
        raise SystemExit('No database exists for this instance.')
    with Database(cfg.database).connect(write=True) as db:
        db.execute("INSERT OR REPLACE INTO service_state VALUES('accepting','0')")
        db.execute("INSERT OR REPLACE INTO service_state VALUES('shutdown_requested','1')")
    print('Shutdown requested. Current forwards will finish; queued jobs remain durable.')


if __name__ == '__main__':
    main()
