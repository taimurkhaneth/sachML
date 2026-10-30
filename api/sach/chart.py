"""Draws the verdict image that is sent on WhatsApp (a simple gauge)."""
import io

import matplotlib
matplotlib.use('Agg')                                    # no screen on the server
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

GREEN, AMBER, RED = '#1E9E5A', '#E8A317', '#D7263D'
INK, MUTED = '#1B1F2A', '#6B7280'

LABELS = {'fake': ('Likely FAKE', RED),
          'unsure': ('NOT SURE', AMBER),
          'real': ('Looks REAL', GREEN)}


def make_chart(fake_score, band, real_threshold=0.40, fake_threshold=0.75):
    fake_pct = round(fake_score * 100)
    real_pct = 100 - fake_pct
    label, color = LABELS[band]

    fig = plt.figure(figsize=(7.2, 3.6), dpi=150)
    fig.patch.set_facecolor('white')
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 50)
    ax.axis('off')

    # header
    ax.text(6, 45, 'SACH CHECK  ·  MODEL VERDICT', fontsize=9, color=MUTED, weight='bold')
    ax.text(6, 36.5, label, fontsize=24, color=color, weight='bold', va='center')
    ax.text(94, 39.5, f'{fake_pct}%', fontsize=26, color=color, weight='bold', ha='right', va='center')
    ax.text(94, 32.5, 'chance of being fake', fontsize=9, color=MUTED, ha='right', va='center')

    # gauge: three zones
    x0, x1, y, h = 6, 94, 17, 6
    width = x1 - x0
    zones = [(0, real_threshold, GREEN, 'Looks real'),
             (real_threshold, fake_threshold, AMBER, 'Not sure'),
             (fake_threshold, 1.0, RED, 'Likely fake')]
    for a, b, c, name in zones:
        is_active = (a <= fake_score < b) or (b == 1.0 and fake_score >= a)
        ax.add_patch(FancyBboxPatch((x0 + a * width, y), (b - a) * width, h,
                                    boxstyle='square,pad=0', facecolor=c,
                                    alpha=0.95 if is_active else 0.25, edgecolor='white', lw=2))
        ax.text(x0 + (a + b) / 2 * width, y - 3.5, name, fontsize=8.5, ha='center', va='center',
                color=INK if is_active else MUTED, weight='bold' if is_active else 'normal')

    # marker
    mx = x0 + fake_score * width
    ax.add_patch(Polygon([[mx - 1.6, y + h + 3.2], [mx + 1.6, y + h + 3.2], [mx, y + h + 0.4]],
                         closed=True, color=INK))
    ax.text(x0, y + h + 2.2, '0', fontsize=8, color=MUTED, ha='left')
    ax.text(x1, y + h + 2.2, '100', fontsize=8, color=MUTED, ha='right')

    # real vs fake split bar
    yb = 5
    ax.add_patch(FancyBboxPatch((x0, yb), width * real_pct / 100, 2.6, boxstyle='square,pad=0',
                                facecolor=GREEN, edgecolor='none'))
    ax.add_patch(FancyBboxPatch((x0 + width * real_pct / 100, yb), width * fake_pct / 100, 2.6,
                                boxstyle='square,pad=0', facecolor=RED, edgecolor='none'))
    ax.text(x0, yb + 5, f'Real {real_pct}%', fontsize=9, color=GREEN, weight='bold')
    ax.text(x1, yb + 5, f'Fake {fake_pct}%', fontsize=9, color=RED, weight='bold', ha='right')
    ax.text(50, 1.2, 'Neural network score · judges writing style, not facts · always verify',
            fontsize=7.5, color=MUTED, ha='center')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', facecolor='white')
    plt.close(fig)
    return buf.getvalue()
