#!/bin/sh
# Serve the app locally. ES modules won't load from a file:// URL, so the page must come over HTTP.
# Usage: ./dev.sh [port]
PORT="${1:-8000}"
cd "$(dirname "$0")"
URL="http://localhost:$PORT/meshygradient.html"
echo "Serving at $URL  (Ctrl+C to stop)"
( sleep 0.7; command -v open >/dev/null && open "$URL" ) &
python3 -m http.server "$PORT" --bind 127.0.0.1
