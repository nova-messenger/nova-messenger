#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Check for node
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -f "/Users/samuele/.gemini/antigravity/scratch/bin/node" ]; then
  NODE_BIN="/Users/samuele/.gemini/antigravity/scratch/bin/node"
elif [ -f "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node" ]; then
  NODE_BIN="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
else
  echo "Node.js non trovato nel sistema. Installa Node.js v20+ o v22+."
  exit 1
fi

echo "Avvio di Aether Messenger con: $NODE_BIN"
export PORT=${PORT:-3000}
export HOST=${HOST:-0.0.0.0}

exec "$NODE_BIN" server.js
