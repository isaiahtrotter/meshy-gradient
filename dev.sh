#!/bin/sh
# Serve the app locally. ES modules won't load from a file:// URL, so the page must come over HTTP.
# Usage: ./dev.sh [port]
# Sends Cache-Control: no-store: plain http.server sends no caching headers, so the browser heuristically caches the
# modules and a reload can pair fresh HTML with stale JS (a new button that's present but never wired up).
PORT="${1:-8000}"
cd "$(dirname "$0")"
URL="http://localhost:$PORT/meshygradient.html"
echo "Serving at $URL  (Ctrl+C to stop)"
( sleep 0.7; command -v open >/dev/null && open "$URL" ) &
exec python3 - "$PORT" <<'PY'
import sys, http.server
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), NoCache).serve_forever()
PY
