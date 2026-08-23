#!/bin/bash

# Function to kill background processes on exit
trap "exit" INT TERM
trap "kill 0" EXIT

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Nyaysahayak Development Environment...${NC}"

# Activate Virtual Environment
if [ -d "venv" ]; then
    echo -e "${GREEN}Activating Python virtual environment...${NC}"
    source venv/bin/activate
else
    echo -e "${BLUE}Creating Python virtual environment...${NC}"
    python3 -m venv venv
    source venv/bin/activate
    echo -e "${GREEN}Installing dependencies...${NC}"
    pip install -r requirements.txt
fi

# Start Backend
echo -e "${GREEN}Starting FastAPI Backend...${NC}"
uvicorn main:app --reload --reload-dir backend --port 8000 &
BACKEND_PID=$!

# Start Frontend
echo -e "${GREEN}Starting Next.js Frontend...${NC}"
cd web
npm run dev &
FRONTEND_PID=$!
cd ..

# Wait for processes
wait
