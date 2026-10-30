"""
Loads the trained neural network + its TF-IDF vectorizer and scores text.

The model and the vectorizer always travel together: the network only
understands the exact 5,000 TF-IDF columns it was trained on.
"""
import os
import threading

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')     # hide TensorFlow info spam

import joblib
import numpy as np

from . import config
from .preprocess import clean_text, cut_to_max_words

_lock = threading.Lock()
_model = None
_tfidf = None


def load():
    """Load model files once (called at API start)."""
    global _model, _tfidf
    if _model is None:
        import keras                                    # Keras 3, TensorFlow backend
        _tfidf = joblib.load(config.VECTORIZER_PATH)
        _model = keras.models.load_model(config.MODEL_PATH)
    return _model, _tfidf


def score_cleaned(cleaned_text):
    """Fake probability (0..1) for text that is ALREADY cleaned and cut."""
    model, tfidf = load()
    vector = tfidf.transform([cleaned_text]).toarray().astype('float32')
    with _lock:                                          # one prediction at a time
        prob = model.predict(vector, verbose=0)[0][0]
    return float(np.clip(prob, 0.0, 1.0))


def check_news(message):
    """Same pipeline as check_news() in the notebook (Part 10)."""
    return score_cleaned(cut_to_max_words(clean_text(message)))
