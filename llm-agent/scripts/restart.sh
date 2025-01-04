#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Run tests locally first
echo -e "${GREEN}Running local tests...${NC}"
npm test
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Local tests failed${NC}"
    echo -e "${RED}Fix the tests before restarting the container${NC}"
    exit 1
fi

echo -e "${GREEN}Local tests passed, restarting container...${NC}"

echo -e "${GREEN}Stopping containers...${NC}"
docker-compose down

echo -e "${GREEN}Building and starting containers...${NC}"
docker-compose up --build -d

echo -e "${GREEN}Waiting for container to start...${NC}"
sleep 3

# Container is now running
echo -e "${GREEN}✓ Container restarted successfully${NC}"
