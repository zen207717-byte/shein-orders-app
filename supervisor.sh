#!/bin/bash
# supervisor.sh - Keep the app and Cloudflare tunnel running

APP_DIR="/workspace/shein-app"
SERVER_LOG="/tmp/app.log"
TUNNEL_LOG="/tmp/cf_tunnel.log"
TUNNEL_URL_FILE="/tmp/tunnel_url.txt"
CLOUDFLARED="/tmp/cloudflared"
CHECK_INTERVAL=20

cd "$APP_DIR"

# Cleanup function
cleanup() {
  echo ""
  echo "[$(date +%H:%M:%S)] Shutting down..."
  pkill -f "node server.js" 2>/dev/null
  pkill -f cloudflared 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start server
start_server() {
  if ! curl -s -m 2 http://localhost:3000/api/auth/status > /dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] Starting server..."
    pkill -f "node server.js" 2>/dev/null
    sleep 1
    nohup node server.js > "$SERVER_LOG" 2>&1 &
    sleep 3
  fi
}

# Start tunnel
start_tunnel() {
  if ! pgrep -f "cloudflared.*--url" > /dev/null; then
    echo "[$(date +%H:%M:%S)] Starting Cloudflare tunnel..."
    pkill -f cloudflared 2>/dev/null
    sleep 1
    rm -f "$TUNNEL_LOG"
    $CLOUDFLARED tunnel --no-autoupdate --url http://localhost:3000 > "$TUNNEL_LOG" 2>&1 &
    sleep 8
    # Extract URL
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
    if [ -n "$URL" ]; then
      echo "$URL" > "$TUNNEL_URL_FILE"
      echo "[$(date +%H:%M:%S)] Tunnel URL: $URL"
    else
      echo "[$(date +%H:%M:%S)] Tunnel URL not found yet, will retry..."
    fi
  fi
}

echo "[$(date +%H:%M:%S)] Supervisor starting..."

# Initial start
start_server
sleep 2
start_tunnel
sleep 8

# Get URL
URL=$(cat "$TUNNEL_URL_FILE" 2>/dev/null)
if [ -n "$URL" ]; then
  echo "================================================"
  echo "  Public URL: $URL"
  echo "  Username:   admin"
  echo "  Password:   admin123"
  echo "================================================"
fi

# Monitor loop
while true; do
  sleep $CHECK_INTERVAL
  start_server
  start_tunnel
  # Verify URL is accessible
  URL=$(cat "$TUNNEL_URL_FILE" 2>/dev/null)
  if [ -n "$URL" ]; then
    HTTP_CODE=$(curl -s -L -o /dev/null -m 10 -w "%{http_code}" "$URL/api/auth/status" 2>/dev/null)
    if [ "$HTTP_CODE" != "200" ]; then
      echo "[$(date +%H:%M:%S)] URL not accessible (HTTP $HTTP_CODE), restarting tunnel..."
      pkill -f cloudflared 2>/dev/null
      sleep 2
    fi
  fi
done
