# tools/

Scripts for working on lab1090, not part of it: nothing in `src/` imports from here. Each
one's header says what it does and takes; this is the index, and how to regenerate what's
committed.

## Index

Working without aircraft overhead (at night, say):

| Tool          | What it does                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replay.ts`   | Plays a Beast recording over TCP at its recorded pace, like readsb (`--connect`); `--alerts` mixes in synthetic emergencies, `--jamming` a GNSS jammer. Without those, `lab1090 --replay` plays it directly |
| `modulate.ts` | Turns a Beast recording back into RTL-SDR samples, with noise (`--replay`)                                                                                                                                  |

The demodulator and the gain, on sample recordings (`fixtures/local/README.md` says how to
make them) or live:

| Tool               | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `demod-bench.ts`   | Its speed; with `--save` / `--check`, whether a change meant only to be faster changed output |
| `demod-compare.ts` | Ours against readsb on the same samples, and where ours lost what only readsb found           |
| `readsb.ts`        | Reads readsb's output for `demod-compare.ts` and `pulse-shape.ts` (a module, not a command)   |
| `pulse-shape.ts`   | Measures the dongle's pulse shape: the table in `src/lib/demod/pulse.ts`                      |
| `gain-sweep.ts`    | Messages per second at several gains, live over rtl_tcp                                       |

Generating committed files (below):

| Tool                             | Writes                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `oracle*.py`, `dump-messages.ts` | `fixtures/oracle/`: pyModeS's answers, what the decoders are tested against |
| `address-blocks.ts`              | `src/lib/modes/address-blocks.ts`, from ICAO Annex 10                       |
| `geoid-grid.ts`                  | `src/lib/weather/egm96.ts`, from GeographicLib's EGM96 grid                 |
| `sounding.ts`                    | `fixtures/sounding/`: weather balloons, from the University of Wyoming      |
| `hyperlegible-open.py`           | `src/lib/assets/fonts/`: Atkinson Hyperlegible with an open zero            |
| `math-font.py`                   | `src/lib/assets/fonts/`: Noto Sans Math, cut down, for formulas             |

## Regenerating

Each generator writes its file exactly as committed (all checked on 18 Nov 2026), so after a
run `git status` shows nothing unless the input changed. Downloads go into
`fixtures/local/`, which isn't committed.

### pyModeS oracle

[pyModeS](https://github.com/junzis/pyModeS), the reference decoder by the author of "The
1090 MHz Riddle", is our oracle: it computes the expected values for the capture's messages,
and our decoders are tested against them. The output is committed, so `bun test` doesn't
need Python; only regenerating does. What each file holds: `fixtures/README.md`.

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt

bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle.py > fixtures/oracle/crc.tsv
bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-decode.py > fixtures/oracle/decoded.jsonl
tools/.venv/bin/python tools/oracle-codes.py > fixtures/oracle/codes.json
bun tools/dump-messages.ts --timed fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-cpr.py > fixtures/oracle/cpr.json
bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-commb.py > fixtures/oracle/commb.jsonl
tools/.venv/bin/python tools/oracle-synthetic.py   # writes synthetic.jsonl and surface.json
```

### Aircraft address blocks

Which State each block of 24-bit addresses belongs to: ICAO Annex 10, Volume III, Part I,
Chapter 9, Table 9-1, as published by the Swiss Federal Office of Civil Aviation (with
Amendment 92, 28/11/24). The nationality marks (D-, G-, N, …) in
`src/lib/modes/nationality.ts` are kept by hand; its header says where they come from.

```sh
mkdir -p fixtures/local/annex10
curl -L -o fixtures/local/annex10/annex10-vol3.pdf \
  https://www.bazl.admin.ch/dam/en/sd-web/QQ3WlrAoWJRb/icao_annex_10_aeronauticaltelecommunicationsvolumeiii-communicat.pdf
pdftotext -layout fixtures/local/annex10/annex10-vol3.pdf fixtures/local/annex10/annex10-vol3.txt  # poppler-utils
bun tools/address-blocks.ts fixtures/local/annex10/annex10-vol3.txt > src/lib/modes/address-blocks.ts
bun fmt src/lib/modes/address-blocks.ts
```

### EGM96 geoid

Sea level against the WGS84 ellipsoid, for /weather's GNSS heights. EGM96 is the US National
Geospatial-Intelligence Agency's model (public domain); GeographicLib (MIT) publishes it as
grids.

```sh
mkdir -p fixtures/local/geoids
curl -L -o fixtures/local/geoids/egm96-15.tar.bz2 \
  https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm96-15.tar.bz2/download
tar xjf fixtures/local/geoids/egm96-15.tar.bz2 -C fixtures/local/geoids
bun tools/geoid-grid.ts fixtures/local/geoids/geoids/egm96-15.pgm > src/lib/weather/egm96.ts
```

### Weather balloons

The two Lindenberg ascents that bracket the capture (`fixtures/README.md`). The data is the
Deutscher Wetterdienst's (open data, free to use with attribution); the files' headers say
where they came from.

```sh
bun tools/sounding.ts 10393 "2026-11-13 12:00" > fixtures/sounding/10393-2026-11-13-12z.csv
bun tools/sounding.ts 10393 "2026-11-13 18:00" > fixtures/sounding/10393-2026-11-13-18z.csv
```

### Fonts

Atkinson Hyperlegible Next and Mono (Braille Institute, SIL Open Font License 1.1), upright
and italic, with an open zero (the slashed one stays behind the OpenType `zero` feature),
arrows, ✓ ✗ and primes drawn with their own strokes, and Inter's lowercase Greek. The tool's
header says how. Formulas (MathML) get their own font: Noto Sans Math (OFL 1.1), cut down to
what they use (`math-font.py`). `src/lib/assets/fonts/OFL.txt` is the license that goes with
them. The fonts from Google Fonts, at the commits they were made from:

```sh
mkdir -p fixtures/local/fonts
G=https://raw.githubusercontent.com/google/fonts
N=$G/afbb27a87bc4be2b0005e17c144831438e82ab37/ofl/atkinsonhyperlegiblenext
M=$G/3a0be2fdd3252b377a0851f0ba01c3609f99b7ab/ofl/atkinsonhyperlegiblemono
I=$G/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/inter
X=$G/823468bd7825152bce2b8fd2cf740432ad2fce8d/ofl/notosansmath
curl -L -o fixtures/local/fonts/next.ttf "$N/AtkinsonHyperlegibleNext%5Bwght%5D.ttf"
curl -L -o fixtures/local/fonts/next-italic.ttf "$N/AtkinsonHyperlegibleNext-Italic%5Bwght%5D.ttf"
curl -L -o fixtures/local/fonts/mono.ttf "$M/AtkinsonHyperlegibleMono%5Bwght%5D.ttf"
curl -L -o fixtures/local/fonts/mono-italic.ttf "$M/AtkinsonHyperlegibleMono-Italic%5Bwght%5D.ttf"
curl -L -o fixtures/local/fonts/inter.ttf "$I/Inter%5Bopsz,wght%5D.ttf"
curl -L -o fixtures/local/fonts/inter-italic.ttf "$I/Inter-Italic%5Bopsz,wght%5D.ttf"
curl -L -o fixtures/local/fonts/noto-sans-math.ttf "$X/NotoSansMath-Regular.ttf"
tools/.venv/bin/python tools/hyperlegible-open.py fixtures/local/fonts src/lib/assets/fonts
tools/.venv/bin/python tools/math-font.py fixtures/local/fonts src/lib/assets/fonts
```
