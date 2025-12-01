#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Ensure PNPM dependencies are present before running either server.
if [ ! -d "node_modules" ]; then
  pnpm install
fi

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

echo "Installing backend dependencies..."
PYTHONPATH=. .venv/bin/pip install --disable-pip-version-check -r requirements.txt

echo "Starting Next.js and Flask dev servers..."
pnpm exec concurrently \
  -n next,flask \
  -c "cyan.bold,yellow.bold" \
  "pnpm run next-dev" \
  "pnpm run flask-dev"
