"""
Run after installing on the server:   python api/selftest.py

1. Checks the server's model gives the SAME scores as the notebook did
   (Part 10: 0.99, 0.19, 0.97).
2. Makes one Claude call to check the API key works.
3. Saves a sample chart image to logs/selftest_chart.png.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sach import config, predictor
from sach.chart import make_chart
from sach.llm import write_reply
from sach.messages import band_for

SAMPLES = [
    ("وائرل ویڈیو میں دعوی کیا جا رہا ہے کہ حکومت نے تمام موبائل فون بند کرنے کا فیصلہ کر لیا ہے", 0.99),
    ("وزیراعظم نے کابینہ کے اجلاس میں بجٹ تجاویز کی منظوری دے دی", 0.19),
    ("سوشل میڈیا پر جعلی خبر پھیلائی جا رہی ہے کہ کل سے تمام سکول بند ہوں گے", 0.97),
]

ok = True
print('1) Model check (should match the notebook)')
predictor.load()
for text, expected in SAMPLES:
    got = predictor.check_news(text)
    match = abs(got - expected) <= 0.02
    ok &= match
    print(f'   {"OK  " if match else "FAIL"} got {got:.2f}  expected {expected:.2f}')

print('\n2) Claude check')
if not config.ANTHROPIC_API_KEY:
    print('   SKIPPED - ANTHROPIC_API_KEY is empty in .env (bot will use ready-made replies)')
else:
    score = predictor.check_news(SAMPLES[0][0])
    band = band_for(score, config.REAL_THRESHOLD, config.FAKE_THRESHOLD)
    text, used = write_reply(SAMPLES[0][0], '', score, band)
    print(f'   {"OK  " if used else "FAIL"} model={config.CLAUDE_MODEL}')
    print('   ' + text.replace('\n', '\n   '))
    ok &= used

print('\n3) Chart')
config.LOG_DIR.mkdir(exist_ok=True)
out = config.LOG_DIR / 'selftest_chart.png'
out.write_bytes(make_chart(0.87, 'fake', config.REAL_THRESHOLD, config.FAKE_THRESHOLD))
print(f'   saved {out}')

print('\nALL GOOD' if ok else '\nSOMETHING FAILED - see above')
sys.exit(0 if ok else 1)
