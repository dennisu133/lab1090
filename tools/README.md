# Tools

Scripts for working on lab1090, not part of the app: nothing in `src/` imports from here.
Each one's header says how to run it.

## What these are, and when to use them

When the sky is empty (at night, say):

| Tool          | What it does                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replay.ts`   | Plays a Beast recording over TCP, like readsb; with synthetic emergencies (`--alerts`) or a GNSS jammer (`--jamming`). For plain playback, `lab1090 --replay` is enough |
| `modulate.ts` | Turns a Beast recording back into RTL-SDR samples, with noise, for `--replay`                                                                                           |

When working on the demodulator or the gain, with sample recordings (`--record`) or live:

| Tool               | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `demod-bench.ts`   | Its speed; with `--save` / `--check`, whether a change meant only to be faster changed output |
| `demod-compare.ts` | Ours against readsb on the same samples, and where ours lost what only readsb found           |
| `readsb.ts`        | Reads readsb's output for `demod-compare.ts` and `pulse-shape.ts` (a module, not a command)   |
| `pulse-shape.ts`   | Measures the dongle's pulse shape: the table in `src/lib/demod/pulse.ts`                      |
| `gain-sweep.ts`    | Messages per second at several gains, live over rtl_tcp                                       |

When a committed file has to be made again (its source or its generator changed):

| Tool                             | Writes                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| `oracle*.py`, `dump-messages.ts` | `oracle/pymodes/`: pyModeS's answers, what the decoders are tested against |
| `sounding.ts`                    | `oracle/sounding/`: weather balloons, from the University of Wyoming       |
| `address-blocks.ts`              | `src/lib/modes/address-blocks.ts`, from ICAO Annex 10                      |
| `geoid-grid.ts`                  | `src/lib/weather/egm96.ts`, from GeographicLib's EGM96 grid                |
| `hyperlegible-open.py`           | `src/lib/assets/fonts/`: Atkinson Hyperlegible with an open zero           |
| `math-font.py`                   | `src/lib/assets/fonts/`: Noto Sans Math, cut down, for formulas            |

Each writes its file exactly as committed, so a clean `git status` afterwards means nothing
changed. Downloads go into `tools/annex10/`, `geoids/` and `fonts/`, which aren't committed.
The Python ones need a venv:

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
```

### pyModeS

```sh
bun tools/dump-messages.ts oracle/capture.beast \
  | tools/.venv/bin/python tools/oracle.py > oracle/pymodes/crc.tsv
bun tools/dump-messages.ts oracle/capture.beast \
  | tools/.venv/bin/python tools/oracle-decode.py > oracle/pymodes/decoded.jsonl
tools/.venv/bin/python tools/oracle-codes.py > oracle/pymodes/codes.json
bun tools/dump-messages.ts --timed oracle/capture.beast \
  | tools/.venv/bin/python tools/oracle-cpr.py > oracle/pymodes/cpr.json
bun tools/dump-messages.ts oracle/capture.beast \
  | tools/.venv/bin/python tools/oracle-commb.py > oracle/pymodes/commb.jsonl
tools/.venv/bin/python tools/oracle-synthetic.py   # writes synthetic.jsonl and surface.json
```

### Weather balloons

```sh
bun tools/sounding.ts 10393 "2026-11-13 12:00" > oracle/sounding/10393-2026-11-13-12z.csv
bun tools/sounding.ts 10393 "2026-11-13 18:00" > oracle/sounding/10393-2026-11-13-18z.csv
```

### Aircraft address blocks

ICAO Annex 10, Volume III, Part I, Chapter 9, Table 9-1, as published by the Swiss Federal
Office of Civil Aviation (with Amendment 92, 28/11/24). The nationality marks (D-, G-, N, …)
in `src/lib/modes/nationality.ts` are kept by hand.

```sh
mkdir -p tools/annex10
curl -L -o tools/annex10/annex10-vol3.pdf \
  https://www.bazl.admin.ch/dam/en/sd-web/QQ3WlrAoWJRb/icao_annex_10_aeronauticaltelecommunicationsvolumeiii-communicat.pdf
pdftotext -layout tools/annex10/annex10-vol3.pdf tools/annex10/annex10-vol3.txt  # poppler-utils
bun tools/address-blocks.ts tools/annex10/annex10-vol3.txt > src/lib/modes/address-blocks.ts
bun fmt src/lib/modes/address-blocks.ts
```

### EGM96 geoid

The US National Geospatial-Intelligence Agency's model (public domain), as GeographicLib's
grid (MIT).

```sh
mkdir -p tools/geoids
curl -L -o tools/geoids/egm96-15.tar.bz2 \
  https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm96-15.tar.bz2/download
tar xjf tools/geoids/egm96-15.tar.bz2 -C tools/geoids
bun tools/geoid-grid.ts tools/geoids/geoids/egm96-15.pgm > src/lib/weather/egm96.ts
```

### Fonts

Atkinson Hyperlegible Next and Mono (Braille Institute, SIL Open Font License 1.1), upright
and italic, with an open zero (the slashed one stays behind the OpenType `zero` feature),
arrows, ✓ ✗ and primes drawn with their own strokes, and Inter's lowercase Greek. The tool's
header says how. Formulas (MathML) get their own font: Noto Sans Math (OFL 1.1), cut down to
what they use (`math-font.py`). `src/lib/assets/fonts/OFL.txt` is the license that goes with
them. The fonts come from Google Fonts, at the commits they were made from:

```sh
mkdir -p tools/fonts
G=https://raw.githubusercontent.com/google/fonts
N=$G/afbb27a87bc4be2b0005e17c144831438e82ab37/ofl/atkinsonhyperlegiblenext
M=$G/3a0be2fdd3252b377a0851f0ba01c3609f99b7ab/ofl/atkinsonhyperlegiblemono
I=$G/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/inter
X=$G/823468bd7825152bce2b8fd2cf740432ad2fce8d/ofl/notosansmath
curl -L -o tools/fonts/next.ttf "$N/AtkinsonHyperlegibleNext%5Bwght%5D.ttf"
curl -L -o tools/fonts/next-italic.ttf "$N/AtkinsonHyperlegibleNext-Italic%5Bwght%5D.ttf"
curl -L -o tools/fonts/mono.ttf "$M/AtkinsonHyperlegibleMono%5Bwght%5D.ttf"
curl -L -o tools/fonts/mono-italic.ttf "$M/AtkinsonHyperlegibleMono-Italic%5Bwght%5D.ttf"
curl -L -o tools/fonts/inter.ttf "$I/Inter%5Bopsz,wght%5D.ttf"
curl -L -o tools/fonts/inter-italic.ttf "$I/Inter-Italic%5Bopsz,wght%5D.ttf"
curl -L -o tools/fonts/noto-sans-math.ttf "$X/NotoSansMath-Regular.ttf"
tools/.venv/bin/python tools/hyperlegible-open.py tools/fonts src/lib/assets/fonts
tools/.venv/bin/python tools/math-font.py tools/fonts src/lib/assets/fonts
```
