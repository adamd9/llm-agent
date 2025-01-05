#!/bin/bash

# Exit on any error
set -e

echo "Restarting Node.js application..."

# Check if container is running
echo "Checking container status..."
if ! docker-compose ps | grep -q "llm-agent.*Up"; then
    echo "Error: llm-agent container is not running"
    exit 1
fi

# Kill existing Node process and tee process
# Note: This will cause the container to restart due to the exec in entrypoint
echo "Stopping existing Node process..."
docker-compose exec -T llm-agent /bin/sh -c "pkill -f 'node src/index.js' || true"

# Wait for container to restart and stabilize
echo "Waiting for container to restart..."
sleep 5

# Check if the new process is running
if docker-compose exec -T llm-agent /bin/sh -c "pgrep -f 'node src/index.js'" > /dev/null; then
    echo "Node.js application restarted successfully"
    echo "Logs available at: /usr/src/app/data/logs/current.log in the container"
else
    echo "Error: Failed to start Node.js application"
    echo "Container logs:"
    docker-compose logs --tail=20 llm-agent
    exit 1
fi
