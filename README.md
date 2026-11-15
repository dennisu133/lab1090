# Ten Ninety

Live Mode S / ADS-B traffic from an RTL-SDR on a Raspberry Pi, decoded and shown by a
SvelteKit app. The name is the frequency it all happens on: 1090 MHz, where transponders
answer radars and broadcast ADS-B.

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

- **/frames**: every frame as it arrives, color-coded hex, decoded content, counts and rates
  per downlink format, type code and parity verdict, signal histogram.
- **/comm-b**: Comm-B replies (DF20/21), which register they most likely came from and how
  that was inferred, compared with what the same aircraft broadcasts via ADS-B.
- **/weather**: two tabs.
  - **Now**: the air above the receiver, from all aircraft of the last half hour, in
    1,000 ft layers: temperature, lapse rate and wind by altitude, the tropopause (WMO
    definition) and the strongest wind (jet stream or not), and the mean temperature of
    the air column below each layer, from the gap between GNSS height and pressure
    altitude (hypsometric equation, with the EGM96 geoid and the pilots' QNH from 4,0 and
    TC 29). Three more ways to the wind: the geostrophic wind from how the pressure
    surfaces slope (GNSS − baro along each level flight), heading checks that compare each
    aircraft's wind with the others' and correct a compass that's clearly off, and winds
    from turns (a circle fitted through the ADS-B ground vectors: no heading needed).
    Checked against weather balloons in the tests (`fixtures/sounding/`).
  - **Per aircraft**: wind and temperature at each aircraft, worked out from its Comm-B
    registers (5,0 and 6,0): the wind triangle with the World Magnetic Model for the
    declination, and the temperature from true airspeed and Mach. From those: tailwind,
    crosswind and drift, the deviation from the standard atmosphere, the total air
    temperature, the air density.

  Every step shown with its own numbers.

- **/**: the tracker. Live aircraft on a map, coloured by altitude, with their trails of the
  last 10 minutes, a dotted line predicting where each one goes next, circles showing how
  accurate its position is (both can be switched off), and range rings around the receiver.
  Tap one for everything known about it (identity, position, flight, autopilot settings,
  what radars read from it, reception) and its live messages, each value explained. Works on phones too. How positions are
  checked before they're believed: `src/lib/tracker/positions.ts`; how the path ahead is
  predicted: `src/lib/tracker/motion.ts`.

  Map: [MapLibre GL JS](https://maplibre.org/) with vector tiles from
  [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap data) and hillshading from the
  [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), all free and without
  an API key. The browser loads the tiles from those servers directly.

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

| Variable            | Default | What it is                                           |
| ------------------- | ------- | ---------------------------------------------------- |
| `RECEIVER_HOST`     | `pi`    | Host running readsb with Beast output                |
| `RECEIVER_PORT`     | `30005` | readsb Beast output port                             |
| `RECEIVER_POSITION` | –       | Where the antenna is, `"latitude,longitude"` (below) |

### Receiver position

`RECEIVER_POSITION` is where the antenna is. It's used for:

- **Decoding single ADS-B positions** (local CPR decoding): it's the reference point that
  picks which CPR zone the aircraft is in. Without it, positions are only decoded from
  even/odd message pairs. For this it only has to be within about 150 NM of airborne
  aircraft (45 NM for aircraft on the ground).
- **Distances and directions** in /frames ("67 km SW"), and the receiver on the map.
- **/weather**, for aircraft that don't broadcast an ADS-B position: it looks up the magnetic
  declination (and the geoid) there.

Decoding works with a rounded value, but distances and the map are only as exact as it is.
The pages show it (/frames in its status bar), so round it before sharing screenshots or
running the app where others can see it.

## Development

| Command          | What it does                               |
| ---------------- | ------------------------------------------ |
| `bun run dev`    | Dev server (Vite, running on Bun)          |
| `bun test`       | Tests (Bun's test runner)                  |
| `bun run check`  | Type check (`svelte-check`)                |
| `bun run lint`   | Prettier and ESLint                        |
| `bun run format` | Format everything with Prettier            |
| `bun run build`  | Production build (`@sveltejs/adapter-bun`) |

Nothing in the sky (at night, say)? Replay the recording instead of the Pi, at its original
pace:

```sh
bun tools/replay.ts --loop                                # serves it on 127.0.0.1:30105
RECEIVER_HOST=127.0.0.1 RECEIVER_PORT=30105 bun run dev
```

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
