# Verify frontend integration behavior.
from dataclasses import replace
from html.parser import HTMLParser
import posixpath
import re

from app import create_app


class PageAssets(HTMLParser):
    # Initialize the component and its required dependencies.
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.assets = []

    # Handle starttag.
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('name')] = attrs.get('content')
        if tag == 'link':
            self.assets.append(attrs['href'])
        if tag == 'script':
            self.assets.append(attrs['src'])


# Verify live page serves new design and csp compatible assets.
def test_live_page_serves_new_design_and_csp_compatible_assets(client):
    response = client.get('/')
    assert response.status_code == 200
    page = PageAssets()
    page.feed(response.get_data(as_text=True))
    assert len(page.assets) == 4
    assert all(path.startswith('/static/fruispect/') for path in page.assets)
    for path in page.assets:
        assert client.get(path).status_code == 200
    controller = client.get('/static/fruispect/app.js').get_data(as_text=True)
    assert "from './api/live.js'" in controller
    assert 'unsafe-inline' not in response.headers['Content-Security-Policy']


# Verify relative frontend imports remain available through Flask after modularization.
def test_frontend_module_graph_is_served_from_the_same_origin(client):
    pending = ['/static/fruispect/app.js']
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        response = client.get(path)
        assert response.status_code == 200, path
        source = response.get_data(as_text=True)
        for relative in re.findall(r"from\s+['\"]([^'\"]+)['\"]", source):
            assert relative.startswith('.'), (path, relative)
            pending.append(posixpath.normpath(posixpath.join(posixpath.dirname(path), relative)))


# Verify stylesheet imports and local artwork remain available after asset reorganization.
def test_frontend_stylesheet_dependencies_are_served(client):
    pending = ['/static/fruispect/styles.css', '/static/fruispect/operator.css']
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        response = client.get(path)
        assert response.status_code == 200, path
        if path.endswith('.css'):
            for relative in re.findall(r"url\(['\"]?([^'\")]+)", response.get_data(as_text=True)):
                if relative.startswith('data:'):
                    continue
                pending.append(posixpath.normpath(posixpath.join(posixpath.dirname(path), relative)))


# Verify live input limits follow server configuration.
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


# Verify frontend assets cannot read files outside assets.
def test_frontend_assets_cannot_read_files_outside_assets(client):
    assert client.get('/static/fruispect/../../requirements.txt').status_code == 404
    assert client.get('/static/fruispect/%2e%2e/%2e%2e/requirements.txt').status_code == 404
