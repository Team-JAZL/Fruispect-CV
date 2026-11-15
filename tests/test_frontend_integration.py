from dataclasses import replace
from html.parser import HTMLParser

from app import create_app


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('name')] = attrs.get('content')
        if tag == 'link':
            self.assets.append(attrs['href'])
        if tag == 'script':
            self.assets.append(attrs['src'])


def test_live_page_serves_new_design_and_csp_compatible_assets(client):
    response = client.get('/?mode=design-preview')
    assert response.status_code == 200
    page = PageAssets()
    page.feed(response.get_data(as_text=True))
    assert page.meta['fruispect-mode'] == 'live'
    assert page.meta['fruispect-allow-preview'] == 'false'
    assert len(page.assets) == 4
    assert all(path.startswith('/static/fruispect/') for path in page.assets)
    for path in page.assets:
        assert client.get(path).status_code == 200
    controller = client.get('/static/fruispect/app.js').get_data(as_text=True)
    assert "from './api/live.js'" in controller
    assert 'unsafe-inline' not in response.headers['Content-Security-Policy']


def test_live_input_limits_follow_server_configuration(cfg):
    custom = replace(cfg, max_file_bytes=2 * 1024 ** 2, max_pixels=123456,
                     max_batch=17, retention_hours=1.5)
    response = create_app(custom).test_client().get('/')
    page = PageAssets()
    page.feed(response.get_data(as_text=True))
    assert page.meta['fruispect-max-file-bytes'] == str(custom.max_file_bytes)
    assert page.meta['fruispect-max-decoded-pixels'] == str(custom.max_pixels)
    assert page.meta['fruispect-max-batch-images'] == str(custom.max_batch)
    assert page.meta['fruispect-retention-hours'] == str(custom.retention_hours)


def test_frontend_assets_cannot_read_files_outside_assets(client):
    assert client.get('/static/fruispect/../../requirements.txt').status_code == 404
    assert client.get('/static/fruispect/%2e%2e/%2e%2e/requirements.txt').status_code == 404
