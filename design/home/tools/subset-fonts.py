#!/usr/bin/env python3
"""Cut the home page's three fonts down to what an English page needs.

The full files (design/home/fonts-full, the Latin variable files from
Fontsource 5.3.0) carry weights the page never asks for and a few hundred
glyphs for accented letters. This keeps printable ASCII, the Latin-1
punctuation and symbols, the dashes, quotes, ellipsis and arrows, and
whatever else the page itself contains, narrows each weight axis to the
weights the page uses, and writes fonts/*.woff2 with the licence of each
font beside it (fonts/ also holds the docs page's Fraunces, which this
leaves alone).

The set is wider than the page on purpose: there is no build step to catch
a new character, so an edit to the copy should not be able to fall out of
the font. Bricolage Grotesque keeps its optical-size axis: the browser
sets it from the font size, which is what gives the headline its tighter
cut.

usage: python3 design/home/tools/subset-fonts.py    (needs fonttools and brotli)
"""
import io
import os
import shutil

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HOME))
FULL = os.path.join(HOME, 'fonts-full')
PAGE = ROOT                      # the home page: index.html and home.js at the site's root
OUT = os.path.join(PAGE, 'fonts')
# out name: (full file, the weights the page uses, its licence)
FONTS = {
    'bricolage-grotesque.woff2': ('bricolage-grotesque-latin-opsz-normal.woff2', (600, 800), 'OFL-BricolageGrotesque.txt'),
    'inter.woff2': ('inter-latin-wght-normal.woff2', (400, 700), 'OFL-Inter.txt'),
    'jetbrains-mono.woff2': ('jetbrains-mono-latin-wght-normal.woff2', (400, 700), 'OFL-JetBrainsMono.txt'),
}
KEEP = (
    [chr(c) for c in range(0x20, 0x7f)]            # printable ASCII
    + [chr(c) for c in range(0xa0, 0x100)]         # Latin-1: no-break space, middle dot, multiplication sign, accents
    + list('‐‑‒–—―')  # hyphens and dashes
    + list('‘’‚“”„')  # quotes
    + list('•…′″')              # bullet, ellipsis, primes
    + list('←↑→↓−')        # arrows, minus
)


def page_text():
    text = ''
    for name in ('index.html', 'home.js'):
        path = os.path.join(PAGE, name)
        if os.path.exists(path):
            text += open(path, encoding='utf-8').read()
    return text


def main():
    os.makedirs(OUT, exist_ok=True)
    extra = sorted({c for c in page_text() if ord(c) > 126} - set(KEEP))
    chars = ''.join(KEEP) + ''.join(extra)
    for name, (full, weights, licence) in FONTS.items():
        font = TTFont(os.path.join(FULL, full))
        font = instancer.instantiateVariableFont(font, {'wght': weights})
        # (through a file and back: the subsetter needs the narrowed font's tables as a saved font has them)
        narrowed = io.BytesIO()
        font.flavor = None
        font.save(narrowed)
        font = TTFont(io.BytesIO(narrowed.getvalue()))
        opt = subset.Options()
        opt.flavor = 'woff2'
        opt.layout_features = ['*']      # kerning, and the mono's code ligatures, stay
        opt.name_IDs = ['*']
        opt.notdef_outline = True
        sub = subset.Subsetter(opt)
        sub.populate(text=chars)
        sub.subset(font)
        buf = io.BytesIO()
        font.flavor = 'woff2'
        font.save(buf)
        open(os.path.join(OUT, name), 'wb').write(buf.getvalue())
        shutil.copyfile(os.path.join(FULL, licence), os.path.join(OUT, licence))
        cmap = font.getBestCmap()
        lost = [c for c in page_text() if ord(c) > 32 and ord(c) not in cmap]
        axes = ', '.join(f'{a.axisTag} {a.minValue:g} to {a.maxValue:g}' for a in font['fvar'].axes)
        print(f'{name}: {os.path.getsize(os.path.join(FULL, full)):,} -> {len(buf.getvalue()):,} bytes, {len(font.getGlyphOrder())} glyphs, {axes}'
              + (f' | NOT IN THIS FONT: {"".join(sorted(set(lost)))}' if lost else ''))
    if extra:
        print('kept for the page, beyond the standing set:', ' '.join(extra))


main()
