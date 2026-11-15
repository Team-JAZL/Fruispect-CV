# Start isolated web and inference processes under supervisor control.
import logging
import os
import signal
from app import create_app
from app.queue.worker import run_worker


# Leave console shutdown handling to the parent supervisor.
def ignore_console_interrupts():
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, signal.SIG_IGN)


# Configure child signal handling and run one model worker.
def worker_entry(key, cfg, stop):
    ignore_console_interrupts()
    run_worker(key, cfg, stop)


# Bind the Waitress server before reporting web process readiness.
def serve(cfg, ready):
    ignore_console_interrupts()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(processName)s %(levelname)s %(message)s')
    from waitress import create_server
    server = create_server(create_app(cfg), host=os.environ.get('FRUISPECT_HOST', '127.0.0.1'),
                  port=int(os.environ.get('FRUISPECT_PORT', 5000)), threads=20,
                  max_request_body_size=cfg.max_file_bytes * 4 + 1024 * 1024,
                  channel_timeout=360, clear_untrusted_proxy_headers=True,
                  trusted_proxy='::1' if os.environ.get('FRUISPECT_HOST') == '::1' else '127.0.0.1',
                  trusted_proxy_headers={'x-forwarded-proto'})
    ready.set()
    server.print_listen('Serving on http://{}:{}')
    server.run()
