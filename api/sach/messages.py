"""Fixed WhatsApp texts: the model verdict card and the polite 'cannot check' replies."""

BAND_INFO = {
    'fake':   {'emoji': '🔴', 'en': 'Likely FAKE',  'ur': 'جعلی ہونے کا امکان زیادہ ہے'},
    'unsure': {'emoji': '🟡', 'en': 'NOT SURE',     'ur': 'یقین سے کچھ نہیں کہا جا سکتا'},
    'real':   {'emoji': '🟢', 'en': 'Looks REAL',   'ur': 'عام خبر جیسی لگتی ہے'},
}

SOURCE_TEXT = {
    'text': 'your message',
    'link': 'the link headline',
    'both': 'your message + the link headline',
}


def band_for(score, real_threshold, fake_threshold):
    if score >= fake_threshold:
        return 'fake'
    if score < real_threshold:
        return 'real'
    return 'unsure'


def model_verdict_message(score, band, source, words_used):
    info = BAND_INFO[band]
    fake_pct = round(score * 100)
    real_pct = 100 - fake_pct
    return (
        f"🧪 *SACH CHECK · Model Verdict*\n"
        f"\n"
        f"{info['emoji']} *{info['en']}*\n"
        f"{info['ur']}\n"
        f"\n"
        f"Fake: *{fake_pct}%*   |   Real: *{real_pct}%*\n"
        f"\n"
        f"📄 Checked: {SOURCE_TEXT.get(source, 'your message')} ({words_used} words)\n"
        f"🧠 Neural network trained on 9,235 labeled Urdu news items\n"
        f"_It reads writing style, not facts. Please verify before forwarding._"
    )


STATUS_MESSAGES = {
    'not_urdu': (
        "🧪 *Sach Check*\n\n"
        "معذرت! میں ابھی صرف *اردو رسم الخط* میں لکھی خبریں چیک کر سکتا ہوں۔ "
        "براہ کرم خبر اردو میں بھیجیں۔\n"
        "_Sorry, I can only check news written in Urdu script for now._"
    ),
    'too_short': (
        "🧪 *Sach Check*\n\n"
        "یہ پیغام بہت مختصر ہے۔ پوری خبر بھیجیں تاکہ میں اسے صحیح طرح چیک کر سکوں۔\n"
        "_Please send the full news text._"
    ),
    'link_unreadable': (
        "🧪 *Sach Check*\n\n"
        "میں یہ لنک نہیں کھول سکا۔ فیس بک، یوٹیوب اور انسٹاگرام کے لنک اکثر بند ہوتے ہیں۔ "
        "براہ کرم خبر کا متن کاپی کر کے بھیجیں۔\n"
        "_I couldn't read this link. Please paste the news text instead._"
    ),
    'error': (
        "🧪 *Sach Check*\n\n"
        "معذرت، ابھی کچھ تکنیکی مسئلہ ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔\n"
        "_Something went wrong, please try again in a minute._"
    ),
}
