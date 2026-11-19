"""
The app's fonts: Atkinson Hyperlegible Next and Mono (Braille Institute, SIL Open Font License
1.1, no Reserved Font Name) with an open zero, renamed "Hyperlegible Open" and "Hyperlegible
Open Mono" so they aren't mistaken for the originals. See tools/README.md.

  python tools/hyperlegible-open.py fixtures/local/fonts src/lib/assets/fonts

reads next.ttf, next-italic.ttf, mono.ttf and mono-italic.ttf (Google Fonts' variable fonts,
weights 200–800) from the first directory and writes hyperlegible-open[-mono][-italic].woff2
into the second.

What changes, in all four:
- `zero`: open. Atkinson's zero is slashed: an outer ring and two inner half-counters cut
  apart by the slash. The open one keeps the ring and gets one inner counter instead: the ring
  scaled about its centre down to the inner extremes the slashed zero had, so the stroke keeps
  its width at the left, right, top and bottom. Italics are straightened first (by the
  italic angle) and slanted again after. Done at every master, and the variation deltas are
  solved again from those masters.
- `zero.slash`: the original slashed zero, behind the OpenType `zero` feature
  (`font-feature-settings: 'zero'`). The mono already had that feature (for a dotted zero,
  which it no longer reaches); the sans gets it, with `zero.tf.slash` for tabular figures.
"""

import copy
import math
import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as ot
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.iup import iup_delta
from fontTools.varLib.models import VariationModel, supportScalar


def points_at(font, name, loc):
    """The outline points of `name` plus its 4 phantom points (as deltas) at a location."""
    glyf = font['glyf']
    coords, ends, _ = glyf[name].getCoordinates(glyf)
    pts = [list(p) for p in coords] + [[0, 0] for _ in range(4)]
    for tv in font['gvar'].variations.get(name, []):
        s = supportScalar(loc, tv.axes)
        if not s:
            continue
        d = tv.coordinates
        if None in d[: len(coords)]:
            d = iup_delta(d[: len(coords)], coords, ends) + list(d[len(coords) :])
        for i, p in enumerate(d):
            if p:
                pts[i][0] += s * p[0]
                pts[i][1] += s * p[1]
    return pts


def bbox(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def open_zero(font):
    glyf, gvar = font['glyf'], font['gvar']
    old = glyf['zero']
    coords, ends, flags = old.getCoordinates(glyf)
    assert len(ends) == 3, 'expected a ring and two half-counters'
    n = ends[0] + 1  # points on the ring
    slant = math.tan(math.radians(-font['post'].italicAngle))
    tvs = gvar.variations['zero']
    locs = [{}] + [{axis: peak for axis, (_, peak, _) in tv.axes.items()} for tv in tvs]

    masters = []
    for loc in locs:
        pts = points_at(font, 'zero', loc)
        upright = [[x - y * slant, y] for x, y in pts[: len(coords)]]
        ring, counters = upright[:n], upright[n:]
        ox0, oy0, ox1, oy1 = bbox(ring)
        ix0, iy0, ix1, iy1 = bbox(counters)
        sx, sy = (ix1 - ix0) / (ox1 - ox0), (iy1 - iy0) / (oy1 - oy0)
        ocx, ocy, icx, icy = (ox0 + ox1) / 2, (oy0 + oy1) / 2, (ix0 + ix1) / 2, (iy0 + iy1) / 2
        counter = [[icx + (x - ocx) * sx, icy + (y - ocy) * sy] for x, y in ring]
        counter = [counter[0]] + counter[1:][::-1]  # a counter runs the other way round
        slanted = [[x + y * slant, y] for x, y in ring + counter]
        masters.append(slanted + pts[len(coords) :])

    model = VariationModel(locs)
    assert model.supports[1:] == [tv.axes for tv in tvs], 'masters not as expected'
    deltas = [[None] * len(masters[0]) for _ in model.supports]
    for i in range(len(masters[0])):
        dx = model.getDeltas([m[i][0] for m in masters])
        dy = model.getDeltas([m[i][1] for m in masters])
        for k in range(len(model.supports)):
            deltas[k][i] = (round(dx[k]), round(dy[k]))

    ring_flags = [flags[i] for i in range(n)]
    new = Glyph()
    new.numberOfContours = 2
    new.coordinates = GlyphCoordinates(deltas[0][: 2 * n])
    new.flags = bytearray(ring_flags + [ring_flags[0]] + ring_flags[1:][::-1])
    new.endPtsOfContours = [n - 1, 2 * n - 1]
    new.program = copy.deepcopy(old.program)
    new.recalcBounds(glyf)
    glyf['zero'] = new
    gvar.variations['zero'] = [TupleVariation(tv.axes, deltas[k + 1]) for k, tv in enumerate(tvs)]


def add_glyph(font, name, glyph, like):
    """A new glyph with `like`'s metrics, variations, glyph class and advance variation."""
    glyf = font['glyf']
    font.setGlyphOrder(font.getGlyphOrder() + [name])
    glyf.glyphOrder = font.getGlyphOrder()
    glyf[name] = glyph
    font['hmtx'][name] = font['hmtx'][like]
    font['gvar'].variations[name] = copy.deepcopy(font['gvar'].variations.get(like, []))
    classes = font['GDEF'].table.GlyphClassDef
    if classes and like in classes.classDefs:
        classes.classDefs[name] = classes.classDefs[like]
    hvar = font['HVAR'].table
    for vmap in (hvar.AdvWidthMap, hvar.LsbMap, hvar.RsbMap):
        if vmap:
            vmap.mapping[name] = vmap.mapping[like]


def add_feature(gsub, tag, mapping):
    """A single-substitution feature, last in the lookup order, in every script and language."""
    lookup = ot.Lookup()
    lookup.LookupType, lookup.LookupFlag = 1, 0
    sub = ot.SingleSubst()
    sub.mapping = mapping
    lookup.SubTable, lookup.SubTableCount = [sub], 1
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount += 1

    record = ot.FeatureRecord()
    record.FeatureTag = tag
    record.Feature = ot.Feature()
    record.Feature.FeatureParams = None
    record.Feature.LookupListIndex = [gsub.LookupList.LookupCount - 1]
    record.Feature.LookupCount = 1
    records = gsub.FeatureList.FeatureRecord
    at = next((i for i, r in enumerate(records) if r.FeatureTag > tag), len(records))
    records.insert(at, record)
    gsub.FeatureList.FeatureCount += 1

    for script in gsub.ScriptList.ScriptRecord:
        systems = [script.Script.DefaultLangSys] + [r.LangSys for r in script.Script.LangSysRecord]
        for ls in filter(None, systems):
            ls.FeatureIndex = sorted([i + (i >= at) for i in ls.FeatureIndex] + [at])
            ls.FeatureCount = len(ls.FeatureIndex)


def keep_slashed(font):
    glyf = font['glyf']
    add_glyph(font, 'zero.slash', copy.deepcopy(glyf['zero']), 'zero')
    gsub = font['GSUB'].table
    zero_features = [r for r in gsub.FeatureList.FeatureRecord if r.FeatureTag == 'zero']
    if zero_features:  # the mono: point its `zero` feature at the slashed zero
        for r in zero_features:
            for i in r.Feature.LookupListIndex:
                for sub in gsub.LookupList.Lookup[i].SubTable:
                    getattr(sub, 'ExtSubTable', sub).mapping['zero'] = 'zero.slash'
        return
    mapping = {'zero': 'zero.slash'}
    if 'zero.tf' in glyf.glyphs:  # tabular figures: a composite of the zero
        tabular = copy.deepcopy(glyf['zero.tf'])
        tabular.components[0].glyphName = 'zero.slash'
        add_glyph(font, 'zero.tf.slash', tabular, 'zero.tf')
        mapping['zero.tf'] = 'zero.tf.slash'
    add_feature(gsub, 'zero', mapping)


def rename(font, family):
    for record in font['name'].names:
        text = record.toUnicode()
        for old in ('Atkinson Hyperlegible Next', 'Atkinson Hyperlegible Mono'):
            text = text.replace(old, family).replace(old.replace(' ', ''), family.replace(' ', ''))
        record.string = text


if __name__ == '__main__':
    source, out = sys.argv[1:3]
    for name, family, target in (
        ('next', 'Hyperlegible Open', 'hyperlegible-open'),
        ('next-italic', 'Hyperlegible Open', 'hyperlegible-open-italic'),
        ('mono', 'Hyperlegible Open Mono', 'hyperlegible-open-mono'),
        ('mono-italic', 'Hyperlegible Open Mono', 'hyperlegible-open-mono-italic'),
    ):
        font = TTFont(f'{source}/{name}.ttf', recalcTimestamp=False)
        font.ensureDecompiled()  # before the glyph order grows: tables read later would disagree
        keep_slashed(font)
        open_zero(font)
        rename(font, family)
        font.flavor = 'woff2'
        font.save(f'{out}/{target}.woff2')
        print(f'{out}/{target}.woff2')
