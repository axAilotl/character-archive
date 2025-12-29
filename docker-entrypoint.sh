#!/bin/sh
set -e

echo "=== Character Archive Container Starting ==="

# Create default config if missing
if [ ! -f /app/config.json ]; then
    echo "Creating default config.json..."
    cat > /app/config.json << 'EOF'
{
    "port": 6969,
    "ip": "0.0.0.0",
    "autoUpdateMode": false,
    "autoUpdateInterval": 60,
    "meilisearch": {
        "enabled": true,
        "host": "http://meilisearch:7700",
        "apiKey": "",
        "indexName": "cards"
    },
    "vectorSearch": {
        "enabled": false,
        "ollamaUrl": "http://host.docker.internal:11434",
        "embedModel": "snowflake-arctic-embed2:latest"
    },
    "sillyTavern": {
        "enabled": false,
        "baseUrl": ""
    }
}
EOF
fi

# Ensure static directory exists
mkdir -p /app/static

# Start backend
echo "Starting backend on port ${PORT:-6969}..."
node /app/server.js &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in $(seq 1 30); do
    if wget -q --spider http://localhost:${PORT:-6969}/ 2>/dev/null; then
        echo "Backend is ready!"
        break
    fi
    sleep 1
done

# Start frontend
echo "Starting frontend on port 3177..."
cd /app/frontend
NODE_ENV=production npm run start &
FRONTEND_PID=$!

echo "=== Character Archive is running ==="
echo "  Backend:  http://localhost:${PORT:-6969}"
echo "  Frontend: http://localhost:3177"

# Handle graceful shutdown
shutdown() {
    echo "Shutting down..."
    kill $FRONTEND_PID 2>/dev/null || true
    kill $BACKEND_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
