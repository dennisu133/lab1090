"""
The font for formulas (MathML): Noto Sans Math (The Noto Project Authors, SIL Open Font
License 1.1, no Reserved Font Name), cut down to what formulas in the UI can use, renamed
"Noto Sans Math Subset". See tools/README.md.

  python tools/math-font.py tools/fonts src/lib/assets/fonts

reads noto-sans-math.ttf (Google Fonts' file) from the first directory and writes
noto-sans-math-subset.woff2 into the second.

Why a maths font at all: the browser lays out MathML with a font's OpenType MATH table (how
far a subscript drops, how a √ or a bracket grows around what it encloses), and writes
single-letter variables with the Mathematical Italic characters (U+1D434…), which only maths
fonts have. Our text font has neither, so without this one the browser borrows a maths font
from the machine: a serif one on Windows (Cambria Math) and macOS (STIX Two Math).

What's kept: Basic Latin and Greek (upright: units, multi-letter names like TAT), their
mathematical italics, the operators the formulas use and a few likely ones, and with them
everything the MATH table and the OpenType features reach (the √'s and brackets' bigger
sizes, the smaller script-size letters). About 55 KB; the whole font is 1 MB.
"""

import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

FAMILY = 'Noto Sans Math Subset'

UNICODES = [
    *range(0x0020, 0x007F),  # Basic Latin
    *range(0x0391, 0x03CA),  # Greek
    0x03D1, 0x03D5, 0x03D6, 0x03F0, 0x03F1, 0x03F5,  # ϑ ϕ ϖ ϰ ϱ ϵ
    *range(0x1D434, 0x1D468),  # mathematical italic A–z (h is U+210E, below)
    0x210E,
    *range(0x1D6E2, 0x1D71C),  # mathematical italic Greek
    0x00B1, 0x00B7, 0x00D7, 0x00F7,  # ± · × ÷
    0x2032, 0x2033,  # ′ ″
    0x2026, 0x22C5,  # … ⋅
    0x2202, 0x2207, 0x2211, 0x221A, 0x221E, 0x222B,  # ∂ ∇ ∑ √ ∞ ∫
    0x2212, 0x2215, 0x2248, 0x2260, 0x2264, 0x2265,  # − ∕ ≈ ≠ ≤ ≥
    0x2190, 0x2192,  # ← →
]


def rename(font, family):
    """Every name record that says Noto Sans Math says `family` (the PostScript name without spaces)."""
    for record in font['name'].names:
        text = record.toUnicode()
        for old, new in (('Noto Sans Math', family), ('NotoSansMath', family.replace(' ', ''))):
            text = text.replace(old, new)
        record.string = text


if __name__ == '__main__':
    source, out = sys.argv[1:3]
    font = TTFont(f'{source}/noto-sans-math.ttf', recalcTimestamp=False)
    options = Options()
    options.layout_features = ['*']  # ssty (script-size letters) and the rest
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    rename(font, FAMILY)
    font.flavor = 'woff2'
    font.save(f'{out}/noto-sans-math-subset.woff2')
    print(f'{out}/noto-sans-math-subset.woff2')
