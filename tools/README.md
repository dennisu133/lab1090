# tools/

Helpers that aren't part of the app. Nothing in `src/` imports from here.

## pyModeS oracle

[pyModeS](https://github.com/junzis/pyModeS) is the reference decoder by the author of
"The 1090 MHz Riddle". We use it as an **oracle**: it computes the expected values for
the messages in our capture, and our own TypeScript decoder is tested against them.

The output is committed (`fixtures/oracle/`), so `bun test` doesn't need Python. You
only need the setup below to regenerate or extend it.

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

- `dump-messages.ts`: prints every distinct Mode S message of a Beast capture as hex,
  using our own Beast parser (the parser has its own tests). With `--timed`: every
  message in order, with its receiver timestamp in seconds.
- `oracle.py`: reads hex messages, writes `message  crc  icao` as TSV.
- `oracle-codes.py`: no input; decodes all 8,192 possible 13-bit altitude and identity
  codes, so those decoders are tested exhaustively, including encodings the capture
  doesn't contain (the old Gillham altitude code).
- `oracle-cpr.py`: reads timed messages, pairs each airborne position with the same
  aircraft's latest one from the other CPR grid (≤ 10 s), and writes pyModeS's global and
  local decodes. The reference for local decoding is the mean of all global positions,
  rounded to whole degrees: derived from the capture, not anyone's configured location.
- `oracle-commb.py`: reads hex messages, and for every distinct Comm-B payload (MB) of
  DF20/21 writes which registers pyModeS's validators accept (1,0 1,7 2,0 3,0 4,0 4,4
  4,5 5,0 6,0), what each decodes to, and which one its inference picks without aircraft
  state, both by default and with the meteorological registers (`include_meteo`). Each
  payload is also included with 1–3 random bit flips (seeded), so the validators are
  compared near their edges too. pyModeS doesn't know 5,1/5,2; those are tested against
  the capture's own ADS-B instead (`src/lib/modes/comm-b.test.ts`). pyModeS 3 dropped
  5,3; that one has hand-made tests, from the layout in pyModeS 2 and ICAO Doc 9871.
- `oracle-synthetic.py`: no input; covers what the capture doesn't contain. Generates
  messages with random (seeded) payloads and a correct CRC for every type code and
  subtype, every operational status version (TC 31), DF18 with each control field, DF19,
  and DF16 coordination replies (VDS 0x30), and writes pyModeS's decode of each. Plus
  surface positions: true positions near 12 references around the world (date line,
  poles, southern hemisphere), encoded as even/odd messages by an encoder in the script
  (checked against pyModeS: every decode lands within 1 m), with pyModeS's local and pair
  decodes. Where pyModeS doesn't decode something (DF18's CF and IMF, TC 29 subtype 0,
  TC 31's capability and mode bits), `synthetic.test.ts` has hand-made cases; their
  layouts come from readsb's decoder and, for the aircraft size, EUROCONTROL's ASTERIX
  CAT021 spec.
- `oracle-decode.py`: reads hex messages, writes everything `pyModeS.decode()` returns
  as JSON lines (callsign, altitude, position fields, velocity, …). This is the reference
  for all decoders after the CRC.

| File                              | Content                                                             | Tested in                                                |
| --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `fixtures/oracle/crc.tsv`         | CRC remainder (syndrome) and address of all 7,481 distinct messages | `src/lib/modes/crc.test.ts`                              |
| `fixtures/oracle/decoded.jsonl`   | Full pyModeS decode of the same messages (1.7 MB)                   | `identification`, `altitude`, `header`, `squitter` tests |
| `fixtures/oracle/codes.json`      | All 8,192 altitude codes and squawks                                | `src/lib/modes/altitude.test.ts`                         |
| `fixtures/oracle/cpr.json`        | NL zone boundaries; global and local CPR decodes of all positions   | `src/lib/modes/cpr.test.ts`                              |
| `fixtures/oracle/commb.jsonl`     | Comm-B registers: validators, decodes, inference (5,467 payloads)   | `src/lib/modes/registers.test.ts`                        |
| `fixtures/oracle/synthetic.jsonl` | 1,272 synthetic messages: every TC/subtype/version, DF16/18/19      | `src/lib/modes/synthetic.test.ts`                        |
| `fixtures/oracle/surface.json`    | 288 surface positions: truth, encoded pair, pyModeS's decodes       | `src/lib/modes/synthetic.test.ts`                        |

pyModeS 3 changed its API (no more `pms.crc()`/`pms.icao()` at the top level); this
uses `pyModeS.util.crc` and `pyModeS.decode(msg)["icao"]`.

## Aircraft address blocks

`src/lib/modes/address-blocks.ts` (which State each block of 24-bit addresses belongs to) is
generated from ICAO Annex 10, Volume III, Part I, Chapter 9, Table 9-1. The Swiss Federal
Office of Civil Aviation publishes the Annex (currently with Amendment 92, 28/11/24):

```sh
mkdir -p /tmp/annex10 && cd /tmp/annex10
curl -L -o annex10-vol3.pdf \
  https://www.bazl.admin.ch/dam/en/sd-web/QQ3WlrAoWJRb/icao_annex_10_aeronauticaltelecommunicationsvolumeiii-communicat.pdf
pdftotext -layout annex10-vol3.pdf annex10-vol3.txt   # poppler-utils
cd - && bun tools/address-blocks.ts /tmp/annex10/annex10-vol3.txt > src/lib/modes/address-blocks.ts
```

- `address-blocks.ts`: reads each row's 24-bit pattern (fixed bits, then dashes) into a
  range, joins State names that wrap onto a second line, and fails if two blocks overlap.
  `src/lib/modes/nationality.test.ts` checks the result: 196 blocks of the sizes the Annex
  allows, spot checks, every address in the capture allocated.
- The nationality marks (D-, G-, N, …) in `src/lib/modes/nationality.ts` are maintained by
  hand: taken from [jet1090](https://github.com/xoolive/jet1090)'s `data/patterns.json` (MIT)
  by matching its address ranges to these blocks, then completed (see the file's header).
  Comm-B register 2,1 (the registration) is checked against them.

## EGM96 geoid grid

`src/lib/weather/egm96.ts` (sea level relative to the WGS84 ellipsoid, for /weather's GNSS
heights) is generated from GeographicLib's 15-minute EGM96 grid. EGM96 is the US National
Geospatial-Intelligence Agency's model (public domain); GeographicLib is MIT-licensed.

```sh
mkdir -p /tmp/geoids && cd /tmp/geoids
curl -L -o egm96-15.tar.bz2 \
  https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm96-15.tar.bz2/download
tar xjf egm96-15.tar.bz2
cd - && bun tools/geoid-grid.ts /tmp/geoids/geoids/egm96-15.pgm > src/lib/weather/egm96.ts
```

- `geoid-grid.ts`: samples the grid every 2° (whole metres, 54 KB of source instead of the
  2.6 MB grid) and prints how far bilinear interpolation on it strays from the full grid:
  at most 17 m anywhere, 9 m over Europe, rms 1.0 m. At FL350 that's under 0.2 K of
  column temperature, below the other uncertainties. `src/lib/weather/geoid.test.ts`
  checks spot values taken from the full grid.

## Weather balloon soundings

`fixtures/sounding/` holds radiosonde ascents from Lindenberg (WMO 10393), the German
Weather Service's observatory near the receiver, as an independent check of /weather
(`src/lib/weather/sounding.test.ts`). They come from the University of Wyoming's sounding
archive, which serves the full-resolution data the weather services send out:

```sh
bun tools/sounding.ts 10393 "2026-11-13 12:00" > fixtures/sounding/10393-2026-11-13-12z.csv
bun tools/sounding.ts 10393 "2026-11-13 18:00" > fixtures/sounding/10393-2026-11-13-18z.csv
```

- `sounding.ts`: the station number and the ascent's nominal time in UTC (00, 06, 12 or 18;
  the balloon goes up about 75 minutes earlier). Keeps one row per 25 m up to 100 hPa,
  with time, position, pressure, geopotential height, temperature, mixing ratio and wind.
  The archive often answers "server too busy"; the tool retries for a few minutes.
- The data is the Deutscher Wetterdienst's (open data, free to use with attribution);
  the files' headers say where they came from.

## Replaying a recording

```sh
bun tools/replay.ts [fixtures/capture.beast] [--port 30105] [--speed 1] [--loop] [--alerts]
bun run dev --connect 127.0.0.1:30105
```

- `replay.ts`: serves a Beast recording over TCP like readsb does, so the app can run
  without the Pi or when nothing is flying. Frames go out at the pace they were recorded
  (by their 12 MHz timestamps), so CPR pairs, trails and dead reckoning behave as live.
  `--speed 2` plays twice as fast; `--loop` starts over at the end, where the aircraft jump
  back to their starting points (the tracker rejects that jump three times, then starts
  their tracks afresh). `--alerts` mixes synthetic emergencies, an IDENT and an ACAS
  advisory into the recording (`src/lib/tracker/alert-scenario.ts` has the timeline; the
  capture itself has none), to see the alerts work: with `--speed 4 --loop` every one of
  them comes round within 2.5 minutes.

## Samples for the demodulator

```sh
bun tools/modulate.ts [fixtures/capture.beast] [--seconds 60] [--out sky.u8]
                      [--noise noise.u8 | --sigma 0.0095] [--gain-db 0]
bun run dev --samples sky.u8
```

- `modulate.ts`: turns a Beast recording back into what the RTL-SDR would have delivered
  (`src/lib/demod/modulate.ts`: preamble and bit pulses at each message's timestamp and
  signal level, plus `--gain-db`, on a random carrier phase), with noise: Gaussian
  (`--sigma`, full scale = 1; the Pi's dongle has about 0.0095) or a recording of the
  dongle with nothing on air (`--noise`, looped), which is closer to the real thing. 4.8 MB
  per second.

## Tuning the demodulator against readsb

```sh
rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 720000000 x.u8                 # 5 min, 1.4 GB
readsb --device-type ifile --ifile x.u8 --iformat UC8 > x.readsb    # the Pi has readsb
bun tools/demod-compare.ts x.u8 x.readsb [--list]
bun tools/pulse-shape.ts x.u8 x.readsb [every]
bun tools/demod-bench.ts x.u8 [seconds] [--save x.out | --check x.out]
```

Real traffic, not modulate.ts: the point is what the dongle does to the signal.

- `readsb.ts`: reads readsb's verbose output (without `--raw`), which gives every message
  its `receiverTime`, counted in samples like our timestamps; the two clocks differ by a
  constant, found from messages both decoded.
- `demod-compare.ts`: our Demodulator and readsb on the same file, message by message (by
  content and time): how many each found, how many only one of them, and for each one only
  readsb found, where ours lost it (quick test, preamble, bits, address not heard yet). DF11
  replies to a radar are counted apart: one wrong bit among their last 7 gives another
  radar's code, and neither side can check which is right.
- `demod-bench.ts`: how fast the demodulator is on a recording (as a share of one core), and
  with `--save` / `--check` whether a change meant only to be faster left every message
  as it was. Builds for the Pi with `bun build --compile --target=bun-linux-arm64`.
- `pulse-shape.ts`: measures the pulse as the dongle delivers it, by least squares over the
  messages readsb got intact (it knows all their bits): the table in
  `src/lib/demod/pulse.ts`, which the demodulator reads bits with (`sequence.ts`).

Afternoon of 18 Nov 2026, R820T at 49.6 dB (two 5-minute recordings) and 40.2 dB (2
minutes, all three in `recordings/`): lab1090 finds 17–22 % more messages than readsb and misses 0.3–0.4 % of
those readsb finds (not counting DF11 radar codes). Before, with bits read one at a time
(first half against second) and a preamble ratio of 2, it found 4–5 % fewer than readsb and
missed 6–8 % of them. The steps in between: bits read as a sequence over the measured pulse
(+14–19 %, missing 1.7–2.3 %), then readsb's slicer, its quick test and its format repair
(`src/lib/demod/readsb.ts`, `filter.ts`). On a Pi 5 that takes 4.5 % of a core at 49.6 dB
and 5.0 % at 40.2 dB.

## Choosing the gain

```sh
rtl_tcp -a 127.0.0.1                                  # on the receiver, dongle free
bun tools/gain-sweep.ts 127.0.0.1 [--steps 40.2,44.5,48.0,49.6] [--dwell 40] [--rounds 4]
                        [--settle 2] [--trace]
```

- `gain-sweep.ts`: messages per second at a handful of gains, live. rtl_tcp changes the
  gain without a restart, and our Demodulator runs on what comes in. Traffic changes by the
  minute (one close aircraft is worth more than any gain step), so it goes round the steps
  several times, up and down in turn, and compares each step with the mean of its own
  round. Short steps and many rounds (`--dwell 5 --rounds 20`) compare gains more fairly
  than long ones. `--trace` prints the noise level just after the first changes: it
  follows within 0.1 s, so a second of `--settle` is plenty. Build it for the Pi like
  demod-bench.ts and run it there: no network in between.
