"""
The app's fonts: Atkinson Hyperlegible Next and Mono (Braille Institute, SIL Open Font License
1.1, no Reserved Font Name) with an open zero, renamed "Hyperlegible Open" and "Hyperlegible
Open Mono" so they aren't mistaken for the originals. See tools/README.md.

  python tools/hyperlegible-open.py oracle/local/fonts src/lib/assets/fonts

reads next.ttf, next-italic.ttf, mono.ttf and mono-italic.ttf (Google Fonts' variable fonts,
weights 200–800), and inter.ttf and inter-italic.ttf (Inter, also OFL 1.1, for the Greek) from
the first directory and writes hyperlegible-open[-mono][-italic].woff2 into the second.

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
- µ (the micro sign, U+00B5): the Greek μ's glyph. Atkinson draws only the letter.
- ← → ↑ ↓ ✓ ✗ ′ ″, new: the UI shows them, and without them the browser takes them from
  whatever font the machine has. Arrows, ✓ and ✗ drawn as strokes with Atkinson's pen (as
  thick as its minus and bar at each master, so they get bolder with the weight); the primes
  are the straight quotes ' " leaning forward.
- Lowercase Greek (sans only: the UI writes it in formulas, never in mono): Inter's, scaled
  to Atkinson's x-height and matched to its stem at each master (`greek`).
"""

import copy
import math
import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as ot
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates, flagOverlapSimple
from fontTools.ttLib.tables.ttProgram import Program
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.models import VariationModel, normalizeLocation, piecewiseLinearMap, supportScalar


def points_at(font, name, loc):
    """The outline points of `name` plus its 4 phantom points (as deltas) at a location."""
    glyf = font['glyf']
    # With the phantom points, as gvar counts them; for a composite, its components' offsets.
    coords, controls = glyf._getCoordinatesAndControls(name, font['hmtx'].metrics)
    n = len(coords) - 4
    pts = [list(p) for p in coords[:n]] + [[0, 0] for _ in range(4)]
    for tv in font['gvar'].variations.get(name, []):
        s = supportScalar(loc, tv.axes)
        if not s:
            continue
        if None in tv.coordinates:  # points left out: interpolated from their neighbours (IUP)
            tv = copy.deepcopy(tv)
            tv.calcInferredDeltas(coords, controls.endPts)
        for i, p in enumerate(tv.coordinates):
            if p:
                pts[i][0] += s * p[0]
                pts[i][1] += s * p[1]
    return pts


def bbox(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def masters_of(font, name):
    """`name`'s variations, and its masters: the default, then where each variation peaks."""
    tvs = font['gvar'].variations.get(name, [])
    return tvs, [{}] + [{axis: peak for axis, (_, peak, _) in tv.axes.items()} for tv in tvs]


def solve(locs, tvs, masters):
    """
    The points at each master (default first) as the default outline and one set of deltas per
    variation: [default, deltas for tvs[0], …].
    """
    model = VariationModel(locs)
    assert model.supports[1:] == [tv.axes for tv in tvs], 'masters not as expected'
    deltas = [[None] * len(masters[0]) for _ in model.supports]
    for i in range(len(masters[0])):
        dx = model.getDeltas([m[i][0] for m in masters])
        dy = model.getDeltas([m[i][1] for m in masters])
        for k in range(len(model.supports)):
            deltas[k][i] = (round(dx[k]), round(dy[k]))
    return deltas


def open_zero(font):
    glyf, gvar = font['glyf'], font['gvar']
    old = glyf['zero']
    coords, ends, flags = old.getCoordinates(glyf)
    assert len(ends) == 3, 'expected a ring and two half-counters'
    n = ends[0] + 1  # points on the ring
    slant = math.tan(math.radians(-font['post'].italicAngle))
    tvs, locs = masters_of(font, 'zero')

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

    deltas = solve(locs, tvs, masters)
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


def micro_sign(font):
    """µ (U+00B5, as in µs) drawn with the Greek μ: Atkinson has the letter, not the sign."""
    for table in font['cmap'].tables:
        if table.isUnicode() and 0x3BC in table.cmap:
            table.cmap.setdefault(0xB5, table.cmap[0x3BC])


def map_codepoint(font, codepoint, name):
    for table in font['cmap'].tables:
        if table.isUnicode() and (table.format != 4 or codepoint <= 0xFFFF):
            table.cmap.setdefault(codepoint, name)


def draw(font, name, codepoint, like, outline, advance=None):
    """
    A new glyph for `codepoint`, drawn at each of `like`'s masters by `outline(loc)`: contours,
    each a list of (x, y, on curve), the same points at every master. Its variations are solved
    from those; the advance's variation and the glyph class are `like`'s, the advance too unless
    given. Outlines may overlap.
    """
    tvs, locs = masters_of(font, like)
    shapes = [outline(loc) for loc in locs]
    contours = shapes[0]
    assert all([len(c) for c in s] == [len(c) for c in contours] for s in shapes)
    n = sum(len(c) for c in contours)
    masters = [
        [[x, y] for c in shape for x, y, _ in c] + points_at(font, like, loc)[-4:]
        for loc, shape in zip(locs, shapes)
    ]
    deltas = solve(locs, tvs, masters)

    glyph = Glyph()
    glyph.numberOfContours = len(contours)
    glyph.coordinates = GlyphCoordinates(deltas[0][:n])
    glyph.flags = bytearray(int(on) for c in contours for _, _, on in c)
    if len(contours) > 1:
        glyph.flags[0] |= flagOverlapSimple  # for renderers that would show the overlap
    glyph.endPtsOfContours = [sum(len(c) for c in contours[: i + 1]) - 1 for i in range(len(contours))]
    glyph.program = Program()
    glyph.program.fromBytecode(b'')
    add_glyph(font, name, glyph, like)
    glyph.recalcBounds(font['glyf'])
    font['hmtx'][name] = (advance or font['hmtx'][like][0], glyph.xMin)
    font['gvar'].variations[name] = [TupleVariation(tv.axes, deltas[k + 1]) for k, tv in enumerate(tvs)]
    map_codepoint(font, codepoint, name)


def derive(font, name, codepoint, source, move):
    """A new glyph for `codepoint`: `source`'s outline at every master, each point `move`d."""
    _, ends, flags = font['glyf'][source].getCoordinates(font['glyf'])

    def outline(loc):
        pts = points_at(font, source, loc)
        starts = [0] + [e + 1 for e in ends[:-1]]
        return [
            [(*move(*pts[i]), flags[i] & 1) for i in range(a, e + 1)] for a, e in zip(starts, ends)
        ]

    draw(font, name, codepoint, source, outline)


def stroke(points, width):
    """
    A polyline as an outline, drawn with a pen `width` wide: flat ends, sharp (mitred) corners.
    Clockwise, as TrueType's outer contours run.
    """

    def offset(p, q, d):  # the segment p → q, moved d to its left
        dx, dy = q[0] - p[0], q[1] - p[1]
        length = math.hypot(dx, dy)
        nx, ny = -dy / length * d, dx / length * d
        return (p[0] + nx, p[1] + ny), (q[0] + nx, q[1] + ny)

    def meet(a, b):  # where the lines through a and b cross
        (x1, y1), (x2, y2) = a
        (x3, y3), (x4, y4) = b
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / (
            (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        )
        return x1 + t * (x2 - x1), y1 + t * (y2 - y1)

    def side(d):
        segments = [offset(p, q, d) for p, q in zip(points, points[1:])]
        joins = [meet(a, b) for a, b in zip(segments, segments[1:])]
        return [segments[0][0], *joins, segments[-1][1]]

    contour = side(width / 2) + side(-width / 2)[::-1]
    area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(contour, contour[1:] + contour[:1]))
    return [(x, y, True) for x, y in (contour[::-1] if area > 0 else contour)]


ARROW_ANGLE = 40  # degrees between an arrowhead's arms and its shaft
# How far a tip's sharp corner reaches past its point, per pen width.
MITRE = 1 / (2 * math.sin(math.radians(ARROW_ANGLE)))


def arrow(back, tip, head, width):
    """An arrow from `back` to `tip`: the shaft, and the head's arms (`head` long) as one stroke."""
    dx, dy = tip[0] - back[0], tip[1] - back[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    arms = []
    for sign in (1, -1):
        a = math.radians(180 + sign * ARROW_ANGLE)
        arms.append(
            (
                tip[0] + head * (ux * math.cos(a) - uy * math.sin(a)),
                tip[1] + head * (ux * math.sin(a) + uy * math.cos(a)),
            )
        )
    return [stroke([back, tip], width), stroke([arms[0], tip, arms[1]], width)]


def symbols(font):
    """
    Arrows, ✓, ✗ and primes, which the UI shows and Atkinson doesn't have (the browser would
    take them from whatever font the machine has). Drawn with Atkinson's own pen, so they get
    bolder with the weight like its letters: at each master as thick as its minus (across) and
    its bar | (upright) on average. Arrows on the minus's height, the upright ones from the
    baseline to the cap height.
    """
    mono = font['post'].isFixedPitch
    slant = math.tan(math.radians(-font['post'].italicAngle))
    cap = font['OS/2'].sCapHeight
    side = 68 if mono else 60  # side bearings, about the minus's
    head = 220 if mono else 250  # an arrowhead's arms

    def pen(loc):
        """The pen's width at a master, and the minus's middle (where arrows point along)."""
        _, y0, _, y1 = bbox(points_at(font, 'minus', loc)[:-4])
        x0, _, x1, _ = bbox([[x - y * slant, y] for x, y in points_at(font, 'bar', loc)[:-4]])
        return ((y1 - y0) + (x1 - x0)) / 2, (y0 + y1) / 2

    def slanted(contours):
        return [[(x + y * slant, y, on) for x, y, on in c] for c in contours]

    width0, _ = pen({})
    tip = MITRE * width0  # how far a tip's corner reaches past its point, at the default
    across = font['hmtx']['minus'][0] if mono else 840
    upright = across if mono else round(2 * (side + head * math.sin(math.radians(ARROW_ANGLE))) + width0)

    def horizontal(sign):
        def outline(loc):
            width, axis = pen(loc)
            left, right = (side, axis), (across - side - tip, axis)
            if sign < 0:
                left, right = (across - side, axis), (side + tip, axis)
            return slanted(arrow(left, right, head, width))

        return outline

    def vertical(sign):
        def outline(loc):
            width, _ = pen(loc)
            x = upright / 2
            ends = ((x, 0), (x, cap - tip)) if sign > 0 else ((x, cap), (x, tip))
            return slanted(arrow(*ends, head, width))

        return outline

    draw(font, 'arrowright', 0x2192, 'minus', horizontal(1), across)
    draw(font, 'arrowleft', 0x2190, 'minus', horizontal(-1), across)
    draw(font, 'arrowup', 0x2191, 'minus', vertical(1), upright)
    draw(font, 'arrowdown', 0x2193, 'minus', vertical(-1), upright)

    # ✓ and ✗ in one box, from the baseline to a bit above the x-height: bigger than the
    # multiplication sign ×, which "✗ 12 kt" would otherwise read as.
    box = 420
    marks = across if mono else round(box + 2 * side + width0)

    def mark(polylines):
        def outline(loc):
            width, _ = pen(loc)
            x = (marks - box) / 2
            return slanted([stroke([(x + px, py) for px, py in p], width) for p in polylines])

        return outline

    check = [[(0, 290), (150, 70), (box, 570)]]
    cross = [[(20, 70), (box - 20, 570)], [(20, 570), (box - 20, 70)]]
    draw(font, 'checkmark', 0x2713, 'multiply', mark(check), marks)
    draw(font, 'ballotx', 0x2717, 'multiply', mark(cross), marks)

    # ′ ″: the straight quotes, leaning forward 15° about their middle.
    lean = math.tan(math.radians(15))
    for name, codepoint, source in (('minute', 0x2032, 'quotesingle'), ('second', 0x2033, 'quotedbl')):
        derive(font, name, codepoint, source, lambda x, y: (x + (y - 557) * lean, y))


# Lowercase Greek (μ and π Atkinson has), each with the Latin letter it's spaced like.
GREEK = dict(zip('αβγδεζηθικλνξορςστυφχψω', 'abvoeznoikkvzopcotuoxuw'))


def location(font, user):
    """A location in user units ({'wght': 400}), normalized as gvar counts: avar applied."""
    axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes}
    loc = normalizeLocation(user, axes)
    segments = font['avar'].segments if 'avar' in font else {}
    return {tag: piecewiseLinearMap(v, segments[tag]) if tag in segments else v for tag, v in loc.items()}


def outline_at(font, name, loc):
    """`name`'s contours at a location, (x, y, on curve), composites taken apart."""
    glyf = font['glyf']
    glyph, pts = glyf[name], points_at(font, name, loc)
    if glyph.isComposite():
        contours = []
        for (dx, dy), component in zip(pts, glyph.components):
            (a, b), (c, d) = getattr(component, 'transform', ((1, 0), (0, 1)))
            for contour in outline_at(font, component.glyphName, loc):
                contours.append([(x * a + y * c + dx, x * b + y * d + dy, on) for x, y, on in contour])
        return contours
    _, ends, flags = glyph.getCoordinates(glyf)
    starts = [0] + [e + 1 for e in ends[:-1]]
    return [[(*pts[i], flags[i] & 1) for i in range(a, e + 1)] for a, e in zip(starts, ends)]


def stem(contours, y, slant):
    """How thick the first stroke is that a level line at `y` crosses (italics straightened)."""
    xs = []
    for contour in contours:
        points = [(x - py * slant, py) for x, py, _ in contour]
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
            if (y1 <= y) != (y2 <= y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    return xs[1] - xs[0]


def greek(font, donor):
    """
    Lowercase Greek from `donor` (Inter): Atkinson has only μ and π, and the UI writes formulas
    (ρ, γ, σ, …). Scaled to Atkinson's x-height; at each of Atkinson's masters taken from the
    donor's weight whose stem, scaled, is as thick as Atkinson's (the l's, halfway up the
    x-height), at its smallest optical size. Spaced like the Latin letter it resembles: that
    letter's advance plus the difference the donor has between the two. Italics: the donor's
    italic, straightened by its angle and slanted by Atkinson's.
    """
    ours, theirs = [math.tan(math.radians(-f['post'].italicAngle)) for f in (font, donor)]
    height, their_height = font['OS/2'].sxHeight, donor['OS/2'].sxHeight
    scale = height / their_height
    their_cmap, cmap = donor.getBestCmap(), font.getBestCmap()
    opsz = {a.axisTag: a.minValue for a in donor['fvar'].axes if a.axisTag == 'opsz'}

    def at(weight):
        return location(donor, {**opsz, 'wght': weight})

    def their_advance(name, weight):
        ph = points_at(donor, name, at(weight))[-4:]
        return (donor['hmtx'][name][0] + ph[1][0] - ph[0][0]) * scale

    weights = {}  # Atkinson's masters → the donor's matching weight

    def matching(loc):
        key = tuple(sorted(loc.items()))
        if key not in weights:
            target = stem(outline_at(font, cmap[ord('l')], loc), height / 2, ours)
            low, high = 100, 900
            for _ in range(30):  # the stem grows with the weight
                mid = (low + high) / 2
                thick = stem(outline_at(donor, their_cmap[ord('l')], at(mid)), their_height / 2, theirs)
                low, high = (mid, high) if thick * scale < target else (low, mid)
            weights[key] = (low + high) / 2
        return weights[key]

    for letter, latin in GREEK.items():
        source, like = their_cmap[ord(letter)], cmap[ord(latin)]
        their_like = their_cmap[ord(latin)]
        advance = round(
            font['hmtx'][like][0]
            + their_advance(source, matching({}))
            - their_advance(their_like, matching({}))
        )

        def outline(loc, source=source, like=like, advance=advance):
            weight = matching(loc)
            ph = points_at(font, like, loc)[-4:]
            room = advance + ph[1][0] - ph[0][0] - their_advance(source, weight)
            return [
                [((x - y * theirs) * scale + room / 2 + y * scale * ours, y * scale, on) for x, y, on in c]
                for c in outline_at(donor, source, at(weight))
            ]

        draw(font, f'uni{ord(letter):04X}', ord(letter), like, outline, advance)

    theirs = donor['name'].getDebugName(0)  # their copyright line, next to Atkinson's
    for record in font['name'].names:
        if record.nameID == 0:
            record.string = f'{record.toUnicode()}; {theirs}'


def rename(font, family):
    """The family's names; not the copyright line (0), which the license says stays as it is."""
    for record in font['name'].names:
        if record.nameID == 0:
            continue
        text = record.toUnicode()
        for old in ('Atkinson Hyperlegible Next', 'Atkinson Hyperlegible Mono'):
            text = text.replace(old, family).replace(old.replace(' ', ''), family.replace(' ', ''))
        record.string = text


if __name__ == '__main__':
    source, out = sys.argv[1:3]
    for name, family, target, greek_from in (
        ('next', 'Hyperlegible Open', 'hyperlegible-open', 'inter'),
        ('next-italic', 'Hyperlegible Open', 'hyperlegible-open-italic', 'inter-italic'),
        ('mono', 'Hyperlegible Open Mono', 'hyperlegible-open-mono', None),
        ('mono-italic', 'Hyperlegible Open Mono', 'hyperlegible-open-mono-italic', None),
    ):
        font = TTFont(f'{source}/{name}.ttf', recalcTimestamp=False)
        font.ensureDecompiled()  # before the glyph order grows: tables read later would disagree
        keep_slashed(font)
        open_zero(font)
        micro_sign(font)
        symbols(font)
        if greek_from:  # the UI writes Greek only in sans text (formulas)
            greek(font, TTFont(f'{source}/{greek_from}.ttf'))
        rename(font, family)
        font.flavor = 'woff2'
        font.save(f'{out}/{target}.woff2')
        print(f'{out}/{target}.woff2')
