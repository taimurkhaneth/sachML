# Sach Check — Urdu Fake News Detector on WhatsApp

Forward an Urdu news message or news link to the bot's WhatsApp number. A trained
neural network scores how likely it is to be fake, and the bot replies with:

1. **Model verdict** – a chart image + the fake/real percentages from our neural network.
2. **AI ki raye** – a short, casual, slightly funny explanation written by Claude.

The neural network always makes the decision. Claude only explains it.

**Test results:** 85.9% accuracy, F1 0.861 on 1,386 unseen news items
(details in `docs/Sach_Check_Proposal.docx`).

---

## Repository layout

```
data/          Ax-to-Grind Urdu dataset + cleaned_data.csv
notebooks/     Model.ipynb – cleaning, training and testing, step by step
model/         sach_check_model.keras + tfidf_vectorizer.pkl  (always used together)
api/           Python model API (Flask) – runs the model, reads links, draws the chart, calls Claude
  app.py         the API:  GET /health,  POST /analyze
  selftest.py    checks everything works on the server
  sach/          preprocess (same clean_text as training), predictor, link_reader, chart, llm, messages
bot/           WhatsApp bot (Node.js + whatsapp-web.js)
  index.js       connection, auto-reconnect watchdog, message handling
  src/           allowlist, owner commands, API client, logger
docs/          project proposal
scripts/       setup.sh – one-time install
ecosystem.config.js   pm2 config for both programs
.env.example   settings template (copy to .env)
```

## How a message flows

```
Allowed person forwards news ──► bot (Node, whatsapp-web.js)
                                   │  POST /analyze  (127.0.0.1 only)
                                   ▼
                        model API (Python, Flask)
                        link? → read headline + first lines
                        clean_text → first 40 words → TF-IDF → neural network → score
                        score → verdict band → chart image + Claude reply
                                   │
bot sends ◄────────────────────────┘
  1) chart image + "Model Verdict"
  2) "AI ki raye" (Claude)
```

| Fake score | Verdict | Reply tone |
|---|---|---|
| ≥ 0.75 | 🔴 Likely FAKE | light humour + "please don't forward" |
| 0.40 – 0.75 | 🟡 NOT SURE | neutral, "please verify" |
| < 0.40 | 🟢 Looks REAL | cheerful, still "verify first" |

No jokes on news about death, accidents, illness or disasters (enforced in Claude's system prompt).

---

## Server setup (Ubuntu / Debian)

### 1. System packages (once)

```bash
sudo apt update
sudo apt install -y git python3-venv python3-pip curl \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation
# On Ubuntu 24.04, if libasound2 is not found, use libasound2t64 instead.

# Node.js 20 (skip if `node -v` already shows v18 or newer)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pm2 (skip if `pm2 -v` works)
sudo npm install -g pm2
```

### 2. Get the code and install

```bash
cd ~
git clone https://github.com/taimurkhaneth/sachML.git
cd sachML
bash scripts/setup.sh
```

### 3. Settings

```bash
nano .env
```

- `ANTHROPIC_API_KEY=` paste your Claude API key (it stays on the server only)
- `API_PORT=` a free port; check used ports with `sudo ss -tlnp`. The API listens on
  127.0.0.1 only, so it is never exposed to the internet and needs no firewall rule.

Save with `Ctrl+O`, `Enter`, exit with `Ctrl+X`.

### 4. Self-test

```bash
api/.venv/bin/python api/selftest.py
```

It must show the same scores as the notebook (0.99 / 0.19 / 0.97), a working Claude
reply, and `ALL GOOD`.

### 5. Start and connect WhatsApp

```bash
pm2 start ecosystem.config.js
pm2 logs sach-bot
```

A QR code appears in the logs. On the phone: **WhatsApp → Settings → Linked devices →
Link a device**, scan it. You'll see `✅ Ready`. Press `Ctrl+C` to leave the logs
(the bot keeps running).

If the QR in the terminal is hard to scan, it is also saved as `bot/qr.png`
(download it with `scp`).

Make it survive server reboots:

```bash
pm2 save
pm2 startup      # run the command it prints
```

---

## Who gets replies (allow-list)

The bot runs on your personal WhatsApp, so **it ignores everyone by default**.
Only people you add get replies. Groups and status updates are always ignored.

Send these commands from your phone, in your own **"Message yourself"** chat:

| Command | What it does |
|---|---|
| `!add 03001234567 Ali` | allow a number (name optional) |
| `!add Ali` | typed **inside someone's chat**: allow that person |
| `!remove 03001234567` | remove a number |
| `!remove` | typed inside someone's chat: remove that person |
| `!list` | everyone allowed |
| `!pause` / `!resume` | stop / start all replies |
| `!status` | WhatsApp, model API and Claude status |
| `!check <news>` | test a news text yourself |
| `!help` | show commands |

Answers to commands always go to your "Message yourself" chat. If you type `!add`
inside someone's chat, they will see that one `!add` message; you can delete it for
everyone afterwards.

**Testing yourself:** forward any news into your "Message yourself" chat. The bot checks it there.

**Which messages from allowed people are checked:** forwarded messages, messages with
a link, messages starting with `check` / `چیک`, and long Urdu texts (12+ words, set by
`MIN_WORDS_TO_CHECK`). Normal short chat like "کیسے ہو" is ignored, so family
conversations are not "fact-checked".

The list is saved in `bot/data/allowed.json` (not in git).

---

## Staying connected

- **Saved login** (`bot/.wwebjs_auth/`): restarts reconnect without a new QR.
- **Takeover on conflict:** if WhatsApp Web is opened in a browser elsewhere, the bot
  takes the session back automatically.
- **Watchdog:** checks the connection every minute. After 3 failed checks, the bot
  restarts itself and pm2 brings it back with a fresh browser, still logged in.
- **pm2:** restarts on crash, restarts if memory goes above 900 MB, and does a fresh
  restart every night at 04:30.
- **Keep the phone online** at least once every ~14 days, or WhatsApp unlinks the device.
- Logged out from the phone (Linked devices → Log out)? The bot removes the old session
  and shows a new QR in `pm2 logs sach-bot`.

---

## Updating after a new push

```bash
cd ~/sachML
git pull
pm2 restart sach-api sach-bot
```

## Useful commands

```bash
pm2 status                 # both should be "online"
pm2 logs sach-bot          # WhatsApp side
pm2 logs sach-api          # model side
curl http://127.0.0.1:5055/health      # use your API_PORT
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `setup.sh` says wrong Python version | TensorFlow 2.18 needs Python 3.10–3.12. Install `python3.12` and run `PYTHON=python3.12 bash scripts/setup.sh` |
| `tensorflow-cpu==2.18.1` not found | In `api/requirements.txt`, change it to `tensorflow==2.18.1` and run setup again |
| Bot log: Chrome failed to launch | Install the system packages from step 1, or `sudo apt install chromium` and set `CHROME_PATH=/usr/bin/chromium` in `.env` |
| Allowed person gets no reply | Their WhatsApp may hide their number. Open their chat on your phone and send `!add Name` inside it |
| Self-test scores differ from 0.99 / 0.19 / 0.97 | Versions differ from training. Use the exact versions in `api/requirements.txt` |
| Claude reply missing | `!status` shows whether Claude is on. Check `ANTHROPIC_API_KEY` in `.env`, then `pm2 restart sach-api` |

## Limitations

The model reads writing style, not facts. It was trained on news articles from
2017–2023, Urdu script only. A message that *warns* about a rumour can itself score as
fake because it contains words like "جعلی خبر". The bot always says "likely", never "definitely".

`whatsapp-web.js` is an unofficial library. Use it on your own number at low volume.

## Data

Harris, S., Liu, J., Hadi, H. J., Cao, Y. (2023). *Ax-to-Grind Urdu: Benchmark Dataset
for Urdu Fake News Detection.* IEEE TrustCom 2023.
https://github.com/Sheetal83/Ax-to-Grind-Urdu-Dataset
