#!/bin/sh
set -eu
export PORT="${PORT:-10000}"
case "$PORT" in
    ''|*[!0-9]*) echo 'PORT must be a number' >&2; exit 1 ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ] || [ "$PORT" -eq 8000 ]; then
    echo 'PORT must be between 1024 and 65535, excluding the internal API port 8000' >&2
    exit 1
fi
# Substitute only PORT; preserve Nginx's $uri, $host, and other variables.
envsubst '${PORT}' < /app/deploy/nginx.conf.template > /tmp/flowlist-nginx.conf
nginx -t -c /tmp/flowlist-nginx.conf
exec /usr/bin/supervisord -c /app/deploy/supervisord.conf
