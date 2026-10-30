"""All settings in one place. Values come from the .env file in the repo root."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]          # repo root
load_dotenv(ROOT / '.env')

MODEL_PATH = ROOT / 'model' / 'sach_check_model.keras'
VECTORIZER_PATH = ROOT / 'model' / 'tfidf_vectorizer.pkl'
LOG_DIR = ROOT / 'logs'

API_HOST = os.getenv('API_HOST', '127.0.0.1')
API_PORT = int(os.getenv('API_PORT', '5055'))

# Score bands (fake probability)
FAKE_THRESHOLD = float(os.getenv('FAKE_THRESHOLD', '0.75'))   # >= this -> likely fake
REAL_THRESHOLD = float(os.getenv('REAL_THRESHOLD', '0.40'))   # <  this -> looks real

MIN_WORDS = int(os.getenv('MIN_WORDS', '5'))                  # fewer words -> "too short"

# Claude
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', '').strip()
CLAUDE_MODEL = os.getenv('CLAUDE_MODEL', 'claude-haiku-5-5').strip()
LLM_TIMEOUT_SECONDS = float(os.getenv('LLM_TIMEOUT_SECONDS', '25'))
