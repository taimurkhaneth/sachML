"""
Text cleaning for Sach Check.

IMPORTANT: clean_text() is copied exactly from the training notebook
(notebooks/Model.ipynb, Part 4). A new WhatsApp message must be cleaned in
exactly the same way as the training data, otherwise the model sees text
it was never trained on.
"""
import re

# Every text is cut to its first 40 words, same as in training (Part 6).
MAX_WORDS = 40


def clean_text(text):
    text = str(text)
    text = re.sub(r'http\S+|www\.\S+', ' ', text)                          # 1 links
    text = re.sub(r'^\s*[^\s(]{1,20}\s*\([^)]{1,25}\)', ' ', text)         # 2 source tag
    text = (text.replace('ي', 'ی').replace('ى', 'ی')
                .replace('ك', 'ک').replace('ه', 'ہ'))                      # 3 Arabic -> Urdu
    text = re.sub(r'[ً-ْٰ]', '', text)                      # 4 zer/zabar/pesh
    text = text.lower()                                                    # 5 English lowercase
    text = re.sub(r'[0-9۰-۹٠-٩]', ' ', text)           # 6 digits
    text = re.sub(r'[^؀-ۿa-z\s]', ' ', text)                     # 7 keep letters only
    text = re.sub(r'[۔،؟؛]', ' ', text)                # 8 Urdu punctuation
    text = re.sub(r'\s+', ' ', text).strip()                               # 9 extra spaces
    return text


def cut_to_max_words(cleaned):
    """Keep only the first MAX_WORDS words (same 40-word cut as training)."""
    return ' '.join(cleaned.split()[:MAX_WORDS])


def urdu_share(text):
    """Share of letters that are Urdu/Arabic-script letters (0 to 1).
    Used to politely refuse English or Roman-Urdu messages, because the
    model was trained on Urdu script only."""
    urdu = len(re.findall(r'[؀-ۿ]', text))
    latin = len(re.findall(r'[A-Za-z]', text))
    total = urdu + latin
    return urdu / total if total else 0.0
