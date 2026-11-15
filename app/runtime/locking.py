# Prevent duplicate supervisors with an operating system instance lock.
import os


# Acquire the operating system lock for the configured instance.
def instance_lock(cfg):

    lock = (cfg.instance / 'supervisor.lock').open('a+b')
    try:
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            if lock.read(1) == b'':
                lock.write(b'0'); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise SystemExit('A Fruispect supervisor already owns this instance.')
    return lock
