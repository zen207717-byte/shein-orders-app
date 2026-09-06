#!/bin/bash
# start.sh - Start the SHEIN Orders app with Cloudflare tunnel

set -e

APP_DIR="/workspace/shein-app"
SERVER_LOG="/tmp/app.log"
TUNNEL_LOG="/tmp/cf_tunnel.log"
TUNNEL_URL_FILE="/tmp/tunnel_url.txt"
CLOUDFLARED="/tmp/cloudflared"

cd "$APP_DIR"

# Function to check if server is running
check_server() {
  curl -s -m 2 http://localhost:3000/api/auth/status > /dev/null 2>&1
}

# Function to check if tunnel is running
check_tunnel() {
  pgrep -f "cloudflared.*--url" > /dev/null
}

# Start server if not running
if check_server; then
  echo "[OK] Server is already running"
else
  echo "[..] Starting server..."
  pkill -f "node server.js" 2>/dev/null
  sleep 1
  nohup node server.js > "$SERVER_LOG" 2>&1 &
  sleep 3
  if check_server; then
    echo "[OK] Server started"
  else
    echo "[ERR] Server failed to start. Check $SERVER_LOG"
    cat "$SERVER_LOG"
    exit 1
  fi
fi

# Start tunnel if not running
if check_tunnel; then
  echo "[OK] Tunnel is already running"
  URL=$(cat "$TUNNEL_URL_FILE" 2>/dev/null)
  if [ -n "$URL" ]; then
    echo "Public URL: $URL"
  fi
else
  echo "[..] Starting Cloudflare tunnel..."
  pkill -f cloudflared 2>/dev/null
  sleep 1
  rm -f "$TUNNEL_LOG"
  $CLOUDFLARED tunnel --no-autoupdate --url http://localhost:3000 > "$TUNNEL_LOG" 2>&1 &
  # Wait for URL to appear
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$URL" ]; then
      break
    fi
  done

  if [ -n "$URL" ]; then
    echo "$URL" > "$TUNNEL_URL_FILE"
    echo "[OK] Tunnel started"
    echo "Public URL: $URL"
    # Verify it's accessible
    sleep 5
    HTTP=$(curl -s -L -o /dev/null -m 15 -w "%{http_code}" "$URL/api/auth/status" 2>/dev/null)
    if [ "$HTTP" = "200" ]; then
      echo "[OK] Public URL is accessible"
    else
      echo "[WARN] Public URL returned HTTP $HTTP, may need a moment..."
    fi
  else
    echo "[ERR] Tunnel failed. Check $TUNNEL_LOG"
    tail -20 "$TUNNEL_LOG"
  fi
fi

echo ""
echo "=== Status ==="
echo "Server log: $SERVER_LOG"
echo "Tunnel log: $TUNNEL_LOG"
echo ""
echo "=== Login Info ==="
echo "Username: admin"
echo "Password: admin123"
echo ""
echo "=== Change Password ==="
echo "Go to Settings → Change Password in the app"
