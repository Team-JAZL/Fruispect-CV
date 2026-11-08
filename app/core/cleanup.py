import time
from pathlib import Path
from app.storage.database import transition


def drain_deletions(database, cfg):
    """Retry files briefly held open by a worker on Windows. Never leave the spool."""
    with database.connect() as db:
        paths = [r[0] for r in db.execute('SELECT path FROM file_deletions')]
    cleared = []
    for value in paths:
        path = Path(value).resolve()
        if path.is_relative_to(cfg.spool.resolve()):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                continue
        cleared.append(value)
    if cleared:
        with database.connect(write=True) as db:
            db.executemany('DELETE FROM file_deletions WHERE path=?', [(p,) for p in cleared])
    return len(paths) - len(cleared)


def delete_collections(database, cfg, *, session_id=None, batch_id=None):
    """Caller holds all upload slots; one transaction fences worker claims/completions."""
    where, params = ('session_id=?', [session_id]) if session_id else ('1=1', [])
    if batch_id:
        where += ' AND batch_id=?'
        params.append(batch_id)
    with database.connect(write=True) as db:
        ids = [r[0] for r in db.execute(f'SELECT batch_id FROM batches WHERE {where}', params)]
        count = 0
        for ident in ids:
            rows = db.execute('SELECT image_path,canonical_input_path FROM images WHERE batch_id=?', (ident,)).fetchall()
            count += len(rows)
            for row in rows:
                for value in row:
                    if value:
                        db.execute('INSERT OR IGNORE INTO file_deletions VALUES(?)', (value,))
            db.execute('DELETE FROM batches WHERE batch_id=?', (ident,))
        if session_id is None:
            db.execute("DELETE FROM sqlite_sequence WHERE name IN ('images','events')")
            db.execute("UPDATE model_registry SET last_error=NULL WHERE state='READY'")
            # Includes abandoned raw uploads and derivatives from interrupted runs.
            if cfg.spool.exists():
                db.executemany('INSERT OR IGNORE INTO file_deletions VALUES(?)',
                               [(str(p),) for p in cfg.spool.iterdir() if p.is_file()])
    pending = drain_deletions(database, cfg)
    return {'collections': len(ids), 'photos': count, 'cleanup_pending': pending}


def maintain(database, cfg, recover_inputs=False):
    drain_deletions(database, cfg)
    removed = []
    with database.connect(write=True) as db:
        if recover_inputs:
            # Run only under the supervisor lock, before the server starts.
            for image in db.execute("SELECT * FROM images WHERE input_status='PROCESSING'").fetchall():
                db.execute("UPDATE images SET input_status='FAILED',input_error='Ingestion interrupted before input commit.' WHERE image_id=?", (image['image_id'],))
                for job in db.execute("SELECT * FROM model_jobs WHERE image_id=? AND status='WAITING_FOR_INPUT'", (image['image_id'],)).fetchall():
                    transition(db, job, 'FAILED', error_code='INGESTION_INTERRUPTED', error_message='Please rescan this image.')
        # Delete whole expired batches only when every job is terminal.
        batches = db.execute("""SELECT b.batch_id FROM batches b WHERE b.created_at<?
            AND NOT EXISTS(SELECT 1 FROM images i WHERE i.batch_id=b.batch_id AND i.retention_expires_at>?)
            AND NOT EXISTS(SELECT 1 FROM images i JOIN model_jobs j USING(image_id) WHERE i.batch_id=b.batch_id
            AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING'))""", (time.time() - cfg.retention_hours * 3600, time.time())).fetchall()
        for batch in batches:
            removed.extend(dict(r) for r in db.execute('SELECT image_path,canonical_input_path FROM images WHERE batch_id=?', (batch['batch_id'],)))
            db.execute('DELETE FROM batches WHERE batch_id=?', (batch['batch_id'],))
    for row in removed:
        for path in row.values():
            target = Path(path).resolve()
            if target.is_relative_to(cfg.spool.resolve()):
                target.unlink(missing_ok=True)
    if cfg.spool.exists():
        # Old raw/uncommitted derivatives are safe to remove; never touch active referenced input.
        with database.connect() as db:
            referenced = {Path(r[0]).resolve() for r in db.execute('SELECT image_path FROM images UNION SELECT canonical_input_path FROM images') if r[0]}
        for path in cfg.spool.iterdir():
            if path.is_file() and path.resolve() not in referenced and (recover_inputs or path.stat().st_mtime < time.time() - 3600):
                path.unlink(missing_ok=True)
    return len(removed)
