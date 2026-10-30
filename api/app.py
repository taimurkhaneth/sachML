"""
Sach Check model API.

Runs only on 127.0.0.1 (inside the server). The WhatsApp bot sends it the
message text and gets back the score, the chart image and the replies.

  GET  /health    -> {"ok": true, ...}
  POST /analyze   -> body {"text": "..."}  returns the full result
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Flask, jsonify, request

from sach import config, predictor
from sach.messages import STATUS_MESSAGES
from sach.pipeline import analyze

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger('sach.api')

app = Flask(__name__)
app.json.ensure_ascii = False


@app.get('/health')
def health():
    return jsonify(ok=True, model_loaded=predictor._model is not None,
                   llm_configured=bool(config.ANTHROPIC_API_KEY), claude_model=config.CLAUDE_MODEL)


@app.post('/analyze')
def analyze_route():
    data = request.get_json(silent=True) or {}
    text = str(data.get('text', ''))[:5000]
    try:
        return jsonify(analyze(text))
    except Exception:
        log.exception('analyze failed')
        return jsonify(status='error', message=STATUS_MESSAGES['error']), 500


def main():
    log.info('Loading model from %s', config.MODEL_PATH)
    predictor.load()
    log.info('Model loaded. Claude reply: %s (%s)',
             'ON' if config.ANTHROPIC_API_KEY else 'OFF - using ready-made replies', config.CLAUDE_MODEL)
    try:
        from waitress import serve
        log.info('Serving on http://%s:%s', config.API_HOST, config.API_PORT)
        serve(app, host=config.API_HOST, port=config.API_PORT, threads=4)
    except ImportError:
        app.run(host=config.API_HOST, port=config.API_PORT)


if __name__ == '__main__':
    main()
