#!/usr/bin/env bash
# One-time install on the server. Run from the repo folder:  bash scripts/setup.sh
set -e
cd "$(dirname "$0")/.."

echo "== 1/4 Python version check (needs 3.10, 3.11 or 3.12) =="
PY=${PYTHON:-python3}
$PY -c 'import sys; v=sys.version_info; assert (3,10) <= v[:2] <= (3,12), f"Python {v.major}.{v.minor} found"; print("OK", sys.version.split()[0])' || {
  echo "Need Python 3.10-3.12 for TensorFlow 2.18. Install one (e.g. python3.12) and run: PYTHON=python3.12 bash scripts/setup.sh"; exit 1; }

echo "== 2/4 Python packages (model API) =="
$PY -m venv api/.venv
api/.venv/bin/pip install --upgrade pip -q
api/.venv/bin/pip install -r api/requirements.txt

echo "== 3/4 Node packages (WhatsApp bot) =="
(cd bot && npm install)

echo "== 4/4 Settings file =="
if [ ! -f .env ]; then cp .env.example .env; echo "Created .env - now add your ANTHROPIC_API_KEY and API_PORT:  nano .env"; else echo ".env already exists"; fi

echo
echo "Done. Next: nano .env  ->  api/.venv/bin/python api/selftest.py  ->  pm2 start ecosystem.config.js"
