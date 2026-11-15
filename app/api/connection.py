# Pair remote browsers and manage local phone connection requests.
import hashlib
import hmac
import time
from flask import Blueprint, current_app, g, jsonify, request, session

connection = Blueprint('connection', __name__)


# Request a phone tunnel restart from the localhost operator.
@connection.post('/api/connection/retry')
def retry():
    if not g.local_operator:
        return jsonify(error={'code': 'LOCAL_ONLY', 'message': 'Retry the phone link from localhost on this computer.'}), 403
    if not current_app.extensions['settings'].ngrok_enabled:
        return jsonify(error={'code': 'TUNNEL_DISABLED', 'message': 'Enable FRUISPECT_NGROK and restart to use a phone link.'}), 409
    with current_app.extensions['db'].connect(write=True) as db:
        db.execute("INSERT OR REPLACE INTO service_state VALUES('tunnel_retry','1')")
    return jsonify(retry_requested=True), 202


# Return public connection state and pairing details allowed for this browser.
@connection.get('/api/connection')
def status():
    tunnel = g.tunnel_state
    data = {k: tunnel.get(k) for k in ('status', 'message', 'public_url', 'error_code')}
    data['requires_pairing'] = g.via_tunnel and session.get('tunnel_generation') != tunnel.get('generation')
    data['local_operator'] = g.local_operator
    if g.local_operator and tunnel.get('status') == 'ready':
        data['pair_code'] = tunnel['pair_code']
        data['connect_url'] = tunnel['public_url'] + '/#connect=' + tunnel['pair_code']
    return jsonify(connection=data)


# Validate a rate-limited pairing code and grant the current tunnel session.
@connection.post('/api/connect')
def pair():
    if not g.via_tunnel or g.tunnel_state.get('status') != 'ready':
        return jsonify(error={'code': 'PHONE_LINK_OFFLINE', 'message': 'Open the current phone link from the computer.'}), 409
    limiter = current_app.extensions['pairing_limiter']
    with limiter['lock']:
        now = time.monotonic()
        if now - limiter['window'] >= 60:
            limiter.update(window=now, attempts=0)
        if limiter['attempts'] >= 10:
            return jsonify(error={'code': 'PAIRING_LIMIT', 'message': 'Too many attempts. Try again in a minute.'}), 429, {'Retry-After': '60'}
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error={'code': 'INVALID_PAIRING', 'message': 'Enter the pairing code from the computer.'}), 400
        code = str(data.get('code', ''))[:64].strip().upper().replace('-', '')
        matches = hmac.compare_digest(hashlib.sha256(code.encode()).digest(),
                                      hashlib.sha256(g.tunnel_state['pair_code'].encode()).digest())
        if not matches:
            limiter['attempts'] += 1
            return jsonify(error={'code': 'PAIRING_INVALID', 'message': 'Check the pairing code shown on the computer.'}), 401
    session['tunnel_generation'] = g.tunnel_state['generation']
    return jsonify(paired=True)
