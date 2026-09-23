#!/bin/bash
# Local preview helper (NOT used in production - production uses Docker Compose)
service postgresql status >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null 2>&1
if ! curl -s -o /dev/null http://127.0.0.1:4000/api/health; then
  pkill -f "node dist/main.js" 2>/dev/null
  sleep 0.5
  cd /app/backend && nohup node dist/main.js >> /var/log/deardollar.log 2>&1 &
fi
