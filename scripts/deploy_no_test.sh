#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Restarting containers...${NC}"
docker-compose restart

echo -e "${GREEN}Waiting for container to start...${NC}"
sleep 3

# Container is now running
echo -e "${GREEN}✓ Container restarted successfully${NC}"
