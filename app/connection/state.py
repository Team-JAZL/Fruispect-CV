# Read expiring tunnel state and validate public HTTPS origins.
import json
import time
from urllib.parse import urlsplit


# Read persisted tunnel state and reject an expired ready connection.
def read_tunnel(database):
    with database.connect() as db:
        row = db.execute("SELECT value FROM service_state WHERE key='tunnel'").fetchone()
    state = json.loads(row['value']) if row else {'status': 'local', 'message': 'Use this device to scan.'}
    if state.get('status') == 'ready' and state.get('expires_at', 0) < time.time():
        return {'status': 'offline', 'message': 'Phone link is offline. Scanning on this computer is available.'}
    return state


# Validate a public HTTPS origin without credentials or extra URL components.
def https_origin(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
                and parsed.path in ('', '/') and not parsed.query and not parsed.fragment and parsed.port in (None, 443)):
            return f'https://{parsed.netloc.lower()}'
    except (TypeError, ValueError):
        pass
    return None
