#!/usr/bin/env python3
"""Local dev server for the LEGO Kneesall tour (disables caching so edits show up on reload)."""
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8765))
    print(f'Serving LEGO Kneesall on http://localhost:{port}')
    http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
