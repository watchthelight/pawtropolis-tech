#!/bin/bash
#
# Pawtropolis Tech — scripts/smoke-test.sh
# WHAT: Post-deployment smoke test to verify bot health
# WHY: Catch deployment issues before they affect users
# USAGE: ./scripts/smoke-test.sh
#
# EXIT CODES:
#   0 - All checks passed
#   1 - Health endpoint check failed
#   2 - Bot status check failed
#   3 - High latency detected (warning, still exits 0)

set -e

# Configuration
HEALTH_URL="http://3.209.223.216:3002/api/health"
SSH_HOST="pawtech"
LATENCY_WARN_MS=500
TIMEOUT_SECONDS=10

echo "=== Pawtropolis Smoke Test ==="
echo ""

# Step 1: Check HTTP health endpoint
echo "[1/3] Checking health endpoint..."
HEALTH_RESPONSE=$(curl -sf --max-time $TIMEOUT_SECONDS "$HEALTH_URL" 2>&1) || {
    echo "FAIL: Health endpoint not responding"
    echo "URL: $HEALTH_URL"
    echo "Error: $HEALTH_RESPONSE"
    exit 1
}

echo "Health endpoint responded successfully"

# Step 2: Verify bot is online
echo ""
echo "[2/3] Verifying bot status..."
STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null) || {
    echo "FAIL: Could not parse health response"
    echo "Response: $HEALTH_RESPONSE"
    exit 2
}

if [ "$STATUS" != "online" ]; then
    echo "FAIL: Bot status is '$STATUS' (expected 'online')"
    exit 2
fi

echo "Bot status: online"

# Step 3: Check latency
echo ""
echo "[3/3] Checking latency..."
LATENCY=$(echo "$HEALTH_RESPONSE" | jq -r '.latency' 2>/dev/null)

if [ -n "$LATENCY" ] && [ "$LATENCY" != "null" ]; then
    echo "WebSocket latency: ${LATENCY}ms"

    if [ "$LATENCY" -gt "$LATENCY_WARN_MS" ]; then
        echo "WARN: High latency detected (>${LATENCY_WARN_MS}ms)"
    fi
else
    echo "Latency: Unable to determine"
fi

# Extract additional info for the report
UPTIME=$(echo "$HEALTH_RESPONSE" | jq -r '.uptimeFormatted' 2>/dev/null)
if [ -n "$UPTIME" ] && [ "$UPTIME" != "null" ]; then
    echo "Uptime: $UPTIME"
fi

# Step 4: Quick PM2 check via SSH (optional, doesn't fail on error)
echo ""
echo "[Bonus] PM2 status check..."
PM2_STATUS=$(ssh -o ConnectTimeout=5 "$SSH_HOST" "pm2 jlist 2>/dev/null | jq -r '.[] | select(.name==\"pawtropolis\") | .pm2_env.status'" 2>/dev/null) || {
    echo "WARN: Could not check PM2 status via SSH (non-fatal)"
    PM2_STATUS=""
}

if [ -n "$PM2_STATUS" ]; then
    echo "PM2 process status: $PM2_STATUS"

    if [ "$PM2_STATUS" != "online" ]; then
        echo "WARN: PM2 process not online (status: $PM2_STATUS)"
    fi
fi

echo ""
echo "=== Smoke Test Complete ==="
echo "PASS: All critical checks passed"
exit 0
