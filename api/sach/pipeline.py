"""
The full check for one WhatsApp message:

  message -> (read link if any) -> Urdu check -> clean_text -> first 40 words
          -> TF-IDF -> neural network -> score -> verdict band
          -> chart image + model verdict text + Claude's casual reply
"""
import base64
import csv
import logging
import time

from . import config, predictor
from .chart import make_chart
from .link_reader import find_urls, read_link, remove_urls
from .llm import write_reply
from .messages import STATUS_MESSAGES, band_for, model_verdict_message
from .preprocess import MAX_WORDS, clean_text, urdu_share

log = logging.getLogger('sach.pipeline')


def _status(status, **extra):
    return {'status': status, 'message': STATUS_MESSAGES[status], **extra}


def _log_check(source, score, band, words, used_llm):
    """Keep a simple record of checks (no phone numbers, no message text)."""
    try:
        config.LOG_DIR.mkdir(exist_ok=True)
        path = config.LOG_DIR / 'checks.csv'
        new = not path.exists()
        with open(path, 'a', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            if new:
                w.writerow(['time', 'source', 'fake_score', 'verdict', 'words', 'llm_used'])
            w.writerow([time.strftime('%Y-%m-%d %H:%M:%S'), source, f'{score:.4f}', band, words, used_llm])
    except OSError:
        pass


def analyze(message):
    message = (message or '').strip()
    urls = find_urls(message)
    own_text = remove_urls(message)
    headline, link_text, link_info = '', '', None

    if urls:
        link_info = read_link(urls[0])
        if link_info['ok']:
            headline = link_info['title']
            link_text = f"{link_info['title']} {link_info['snippet']}".strip()

    own_urdu_words = len(clean_text(own_text).split()) if urdu_share(own_text) >= 0.5 else 0

    # Decide what to give the model.
    if link_text and own_urdu_words >= 8:
        text, source = f'{own_text} {link_text}', 'both'      # real news text + link
    elif link_text:
        text, source = link_text, 'link'                       # "dekho ye khabar" + link
    else:
        text, source = own_text, 'text'

    if urls and not link_text and own_urdu_words < 8:
        return _status('link_unreadable', link_error=(link_info or {}).get('error'))
    if urdu_share(text) < 0.5:
        return _status('not_urdu')

    cleaned = clean_text(text)
    words = cleaned.split()
    if len(words) < config.MIN_WORDS:
        return _status('too_short')

    used = ' '.join(words[:MAX_WORDS])
    score = predictor.score_cleaned(used)
    band = band_for(score, config.REAL_THRESHOLD, config.FAKE_THRESHOLD)
    words_used = min(len(words), MAX_WORDS)

    png = make_chart(score, band, config.REAL_THRESHOLD, config.FAKE_THRESHOLD)
    llm_text, used_llm = write_reply(own_text or text, headline, score, band)
    _log_check(source, score, band, words_used, used_llm)

    return {
        'status': 'ok',
        'fake_score': round(score, 4),
        'real_score': round(1 - score, 4),
        'verdict': band,
        'source': source,
        'words_used': words_used,
        'headline': headline,
        'model_message': model_verdict_message(score, band, source, words_used),
        'llm_message': '🤖 *AI ki raye*\n\n' + llm_text,
        'llm_used': used_llm,
        'chart_png': base64.b64encode(png).decode('ascii'),
    }
