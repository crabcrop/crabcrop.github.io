#!/usr/bin/env python3
"""Cut the page's three fonts down to what the page uses.

The full files (src/fonts/full, the Latin subsets from Fontsource) carry a
few hundred glyphs for accented letters the page has none of, and Fraunces
carries a SOFT axis the page leaves at 0. This keeps printable ASCII and the
other characters found in index.html and the scripts, pins SOFT at 0, and
writes src/fonts/*.woff2 with chars.json, the list of what was kept.
scripts/check-fonts.mjs (run by the build) fails if the page gains a
character that is not on that list: then run this again.

usage: python3 scripts/subset-fonts.py    (needs fonttools and brotli)
"""
import glob, io, json, os
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL = os.path.join(ROOT, 'src', 'fonts', 'full')
OUT = os.path.join(ROOT, 'src', 'fonts')
# out name: (full file, axes to pin)
FONTS = {
    'fraunces.woff2': ('fraunces-latin-soft-normal.woff2', {'SOFT': 0}),
    'figtree.woff2': ('figtree-latin-wght-normal.woff2', None),
    'jetbrains-mono.woff2': ('jetbrains-mono-latin-wght-normal.woff2', None),
}


def page_text():
    files = [os.path.join(ROOT, 'index.html')] + glob.glob(os.path.join(ROOT, 'src', '**', '*.ts'), recursive=True) + [os.path.join(ROOT, 'src', 'styles.css')]
    return ''.join(open(f, encoding='utf-8').read() for f in files)


extra = sorted({c for c in page_text() if ord(c) > 126})
chars = [chr(c) for c in range(0x20, 0x7f)] + [' '] + extra
for name, (full, pin) in FONTS.items():
    font = TTFont(os.path.join(FULL, full))
    if pin:
        font = instancer.instantiateVariableFont(font, pin)
    opt = subset.Options()
    opt.flavor = 'woff2'
    opt.layout_features = ['*']      # kerning and the mono's code ligatures stay
    opt.name_IDs = ['*']
    opt.notdef_outline = True
    sub = subset.Subsetter(opt)
    sub.populate(text=''.join(chars))
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = 'woff2'
    font.save(buf)
    open(os.path.join(OUT, name), 'wb').write(buf.getvalue())
    print(name, os.path.getsize(os.path.join(FULL, full)), '->', len(buf.getvalue()), 'bytes,', len(font.getGlyphOrder()), 'glyphs')
json.dump({'note': 'The characters the fonts were cut down to (scripts/subset-fonts.py); printable ASCII is always kept.', 'extra': ''.join(extra)},
          open(os.path.join(OUT, 'chars.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('kept besides ASCII:', ' '.join(extra))
