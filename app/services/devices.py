# Record bounded browser-reported device details at image admission.
import hashlib
import hmac
import re
from flask import current_app, g, request, session


# Normalize an optional browser header without retaining control characters.
def header(name, limit=200):
    value = re.sub(r'[\x00-\x1f\x7f]', '', request.headers.get(name, ''))[:limit].strip().strip('"')
    return value or None


# Capture upload attribution without treating browser reports as hardware identity.
def upload_source():
    agent = header('User-Agent', 1024) or ''
    model = header('Sec-CH-UA-Model')
    if not model:
        android = re.search(r'Android[^;)]*;\s*(?:[a-z]{2}[-_][A-Z]{2};\s*)?([^;)]+)', agent)
        model = android[1].split(' Build/')[0].strip() if android else None
        if model in ('K', 'Mobile'):
            model = None
        if not model:
            model = next((name for name in ('iPhone', 'iPad') if name in agent), None)
    brand = None
    for pattern, name in ((r'^(SM-|GT-|SAMSUNG)', 'Samsung'), (r'^Pixel\b', 'Google'),
                          (r'^(iPhone|iPad)', 'Apple'), (r'^HUAWEI', 'Huawei'), (r'^HONOR', 'Honor'),
                          (r'^ONEPLUS', 'OnePlus'), (r'^Xperia', 'Sony')):
        if model and re.search(pattern, model, re.I):
            brand = name
            break
    platform = header('Sec-CH-UA-Platform')
    if not platform:
        platform = next((name for token, name in (('Android', 'Android'), ('iPhone', 'iOS'), ('iPad', 'iPadOS'),
            ('Windows', 'Windows'), ('Macintosh', 'macOS'), ('CrOS', 'ChromeOS'), ('Linux', 'Linux')) if token in agent), None)
    version = header('Sec-CH-UA-Platform-Version', 60)
    if platform and version:
        platform += ' ' + version
    browser = next((name + ' ' + match[1] for token, name in (('Edg', 'Edge'), ('OPR', 'Opera'),
        ('SamsungBrowser', 'Samsung Internet'), ('CriOS', 'Chrome'), ('FxiOS', 'Firefox'),
        ('Chrome', 'Chrome'), ('Firefox', 'Firefox'), ('Version', 'Safari'))
        if (match := re.search(r'\b' + token + r'/([\d.]+)', agent))), None)
    device_id = hmac.new(current_app.secret_key.encode(), ('device:' + session['sid']).encode(), hashlib.sha256).hexdigest()[:24]
    return {'device_id': device_id, 'brand': brand, 'model': model, 'platform': platform, 'browser': browser,
            'user_agent': agent, 'remote_address': None if g.via_tunnel else request.remote_addr,
            'connection_type': 'tunnel' if g.via_tunnel else 'host' if g.local_operator else 'lan'}
