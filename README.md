# ADS-B receiver

Live Mode S / ADS-B traffic from an RTL-SDR on a Raspberry Pi, decoded and shown by a
SvelteKit app.

## What this is

A learning project about aviation tech, starting with what aircraft transmit on 1090 MHz.
It's meant to become a tracker, but it's built as a learning tool first: the app doesn't
just show decoded values, it explains them. Every field has a tooltip that says what it is,
how it was calculated and what it means, using the field names from the specifications
(ICAO Doc 9871, RTCA DO-260B), so it can be read alongside the literature.

Everything is decoded here, from the raw bits: CRC and address recovery, altitude codes,
callsigns, CPR positions, velocities, status messages and Comm-B registers. The decoders are
tested against [pyModeS](https://github.com/junzis/pyModeS), see [tools/](tools/README.md).

Pages:

- **/raw**: every frame as it arrives, color-coded hex, decoded content, counts and rates
  per downlink format, type code and parity verdict, signal histogram.
- **/comm-b**: Comm-B replies (DF20/21), which register they most likely came from and how
  that was inferred, compared with what the same aircraft broadcasts via ADS-B.
- **/**: the tracker (planned).

## Hardware

The reference setup:

- Raspberry Pi 5 (anything that runs readsb will do)
- [RTL-SDR Blog v3](https://www.rtl-sdr.com/) dongle
- The RTL-SDR Blog dipole antenna kit, mounted outdoors

Notes on the antenna:

- **Length.** At 1090 MHz the wavelength is 27.5 cm. A half-wave dipole is 13.75 cm tip to
  tip (two arms of ~6.9 cm), a quarter-wave monopole over a ground plane is ~6.9 cm. The
  telescopic dipole from the kit doesn't collapse quite that short (~16 cm), which is a bit
  off but works fine.
- **Orientation.** ADS-B is vertically polarized: mount the dipole or monopole vertically.
- **Placement matters most.** 1090 MHz is line of sight: high up, outdoors, with a clear
  view of the horizon beats any antenna upgrade.
- **Keep the coax short.** Thin coax loses a lot at 1090 MHz (RG-174 around 1 dB/m). A
  longer USB cable to a dongle close to the antenna, or a 1090 MHz filtered LNA at the
  antenna, is better than a long coax run.

## Receiver

The Pi is a deliberately "dumb" relay: readsb demodulates, drops frames that fail the CRC,
and streams them raw (Beast format, TCP port 30005). Nothing is decoded there. Setup:
[pi/README.md](pi/README.md).

Any readsb or dump1090 that serves Beast output on port 30005 works, so a Pi that already
feeds a flight tracking network can be used as is.

## Getting started

The project is Bun-native: [Bun](https://bun.sh) installs, runs, tests and serves it.
Node.js and npm are not needed.

```sh
bun install
cp .env.example .env   # then adjust, see Configuration
bun run dev            # http://localhost:5173
```

## Configuration

Copy `.env.example` to `.env`. Everything is optional:

| Variable          | Default | What it is                                                |
| ----------------- | ------- | --------------------------------------------------------- |
| `RECEIVER_HOST`   | `pi`    | Host running readsb with Beast output                     |
| `RECEIVER_PORT`   | `30005` | readsb Beast output port                                  |
| `REFERENCE_POINT` | –       | A point near the receiver, `"latitude,longitude"` (below) |

### Reference point

`REFERENCE_POINT` lets /raw decode a position from a single ADS-B message (local CPR
decoding). Without it, positions are only decoded from even/odd message pairs.

**It doesn't have to be exact, and shouldn't be.** It only picks which CPR zone the
aircraft is in, so it just has to be within about 150 NM of airborne aircraft (45 NM for
aircraft on the ground). Round it to one decimal (≤ 6 km off): /raw shows it in its
status bar. The only visible effect of rounding is on the distances and directions in the
feed ("67 km SW"), which are measured from the reference point, not from the antenna.

## Development

| Command          | What it does                               |
| ---------------- | ------------------------------------------ |
| `bun run dev`    | Dev server (Vite, running on Bun)          |
| `bun test`       | Tests (Bun's test runner)                  |
| `bun run check`  | Type check (`svelte-check`)                |
| `bun run lint`   | Prettier and ESLint                        |
| `bun run format` | Format everything with Prettier            |
| `bun run build`  | Production build (`@sveltejs/adapter-bun`) |

The tests run against a 10-minute recording from the receiver
([fixtures/](fixtures/README.md)) and reference values from pyModeS, which are committed:
Python is only needed to regenerate them ([tools/](tools/README.md)).

## Deployment

```sh
bun run build
bun ./build            # http://localhost:3000, PORT and HOST to change it
```

The server reads `.env` from the working directory. See the
[adapter-bun docs](https://svelte.dev/docs/kit/adapter-bun) for its other options.
