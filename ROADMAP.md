# Roadmap

What's left before Ten Ninety is done. It stays a learning tool for a single RTL-SDR with
a single antenna, and plug and play: the only setting it needs is the receiver's position.
No extra hardware, no antenna height, no server-side storage. Everything new gets the same
treatment as the rest: every value explained, every calculation shown, sources cited.

Phases are ordered by how certain they are, not by size. Experiments come last and get tried
on the capture (`fixtures/capture.beast`) before any UI is built.

## 1. More from adsbdb

adsbdb is already the one non-decoded source (photo, type, registration, owner). It knows
more:

- [x] **Route** from `GET /v0/callsign/{callsign}`: origin and destination airports with
      coordinates. Great circle on the map, progress ("flown 312 of 1,040 km").
- [x] **Plausibility check of the route.** adsbdb's routes can be out of date. Compared with
      what the aircraft does, from positions only (never the heading: controllers vector
      aircraft near airports): near the way (the detour via its position, at most 25 % or
      100 km) and going the right way (over the last minutes closer to the destination or
      further from the origin). Fits, doesn't fit, or can't tell yet. A route that
      doesn't fit isn't shown at all ("unknown"): either adsbdb is right or it's ignored
      (`src/lib/tracker/route.ts`). First live look: 2 of 6 routes stale.
- [x] **Airline** from the same response: name and radiotelephony callsign (DLH is called
      "LUFTHANSA" on the radio). Explain how ICAO airline designators and flight numbers make up
      the callsign.
- [x] **Owner vs operator**: `registered_owner_operator_flag_code` against the callsign's
      airline prefix. A mismatch usually means a leased or wet-leased aircraft.
- [x] **Registration country vs address block**: `registered_owner_country_iso_name` against
      the State the 24-bit address was allocated to (the flag). They should agree; explain why
      they sometimes don't (re-registered aircraft, military).

## 2. Alerts

Visual only, no sound.

- [x] **On the page**: banner, the aircraft highlighted on the map and in the list, a marker in
      the tab title (for a window left open on a second screen).
- [x] **System notifications**, opt-in, via the Notification API from the open tab (no push
      server, no service worker). Browsers only allow it in a secure context (HTTPS or
      `localhost`), so it can't be required: explain that where the switch is.
- [x] **Triggers**, each with an explanation of what it means and what happens next:
  - [x] Squawk 7500 / 7600 / 7700
  - [x] TC 28 subtype 1 emergency states (general, medical, minimum fuel, no communications,
        unlawful interference, downed aircraft). Medical and minimum fuel are priority, not
        distress: amber, unless the squawk is an emergency code.
  - [x] ACAS resolution advisories (TC 28 subtype 2, register 3,0, DF16)
  - [x] IDENT (SPI): not an alert, the aircraft blinks on the map.
  - [ ] An aircraft losing GNSS integrity (NACp / NIC dropping to 0): moved to phase 5's GNSS
        interference experiment. Near jammed areas it could fire for every aircraft, so
        whether it's an alert at all depends on what that shows.
- [x] Tests with synthetic frames; a way to play them through `tools/replay.ts` to see the UI
      (`--alerts`, `src/lib/tracker/alert-scenario.ts`).

## 3. Weather on the map and in the air

- [x] **Wind barbs on the tracker map**: the per-aircraft winds drawn where they were measured
      (the ADS-B position moved on to the reply's time), one per aircraft and minute, over the
      last 30 min, fading, coloured by altitude; dimmed away from the selected aircraft's
      level; tap for a card. Heading-corrected like /weather's default. A "Wind" switch in
      `MapLayers` (`src/lib/map/winds.ts`).
- [x] **Weather in the aircraft panel**: its wind (corrected if its heading is off, with the
      as-sent value), head/tailwind and drift, the heading check, the temperature and ISA
      deviation.
- [x] **Barometric vs inertial vertical rate**: checked on the capture, the tilt dropped. The
      idea: the autopilot holds _pressure_ altitude, so in level flight the inertial rate
      (register 6,0) would show the aircraft riding the tilted pressure surface, the physics
      of `geostrophic.ts` seen from another side. It doesn't. 7 aircraft in level flight
      (±25 ft for 2–8 min): the true height change from GNSS − baro over time is real and
      fits the geostrophic slope (440822 at FL350: +22 ft/min, predicted +20), but the
      inertial rate doesn't follow it (440822: +3; 4400F8 and 3C65D4 the wrong sign; r = 0.27
      over all 7). It's baro-inertial: the inertial channel is unstable on its own, so it's
      held to the barometric altitude and follows the pressure surface too. Side finding:
      TC 19's vertical rate, flagged barometric, is the same blended rate (2,298 pairs: 23
      ft/min rms from 6,0's inertial rate, within TC 19's 64 ft/min step; 142 from 6,0's
      barometric one, which scatters by 90–235 ft/min in level flight: the raw pressure
      change). The capture has too few climbs to see the static system's lag.
  - [ ] Maybe later: both 6,0 rates in the panel, each with what it measures, and the
        geometric rate (GNSS − baro over time), the only one that shows the tilt.
- [x] **Contrails** (Schmidt–Appleman criterion): from the measured temperature, whether
      engines leave contrails. Humidity is almost never known (4,4 is rare), so a range:
      the threshold for saturated air (100 % relative humidity over water) and for dry air
      (0 %), ~10 K colder; in between, the humidity the air would need. Whether contrails
      _persist_ (ice supersaturation) can't be known; the tooltips say so. One engine
      efficiency for all, η = 0.3; a modern engine's 0.4 moves both thresholds 1.5–1.8 K
      warmer. The balloons' check showed the catch: near the thresholds 1 K moves the
      humidity needed by 20–25 points, and single aircraft read 2 K cold on average (one 7 K).
      So every answer allows ±2 K (`TEMPERATURE_MARGIN`), and the panel uses the layer's mean
      when the layer has enough aircraft. The balloons found 6–9 % humidity at FL360–FL380,
      where contrails needed 31–46 %: none that afternoon. The capture's FL370 still says
      "in any air", from its two cold aircraft: the margin can't catch a 7 K error.
  - [x] `src/lib/weather/contrail.ts`: exact tangent, within 0.04 K of Schumann's (1996)
        fit; checked against the balloons in `sounding.test.ts`.
  - [x] On /weather "Now": the band between the two thresholds in the temperature profile,
        and a line under it per run of layers ("FL370 in any air · FL380 needs 10–80 %
        humidity").
  - [x] In the aircraft panel: "Contrail" in "Weather where it flies", with the reasoning
        and what looking up tells you.
  - [x] On /weather/aircraft: a third card in the worked example, the panel's "why": the
        Schmidt–Appleman diagram (water and ice curves, the engine's line, this air as a bar)
        and every step with the observation's own numbers, ending with what the panel says
        for the same aircraft (it may use the layer's mean).
  - [ ] Maybe later: a temperature check like the heading check (each aircraft's
        temperature against the others' at its level), to catch the 7 K aircraft.

## 4. Flight phase

Most receivers, this one included, mostly see cruise traffic. But others will run this near
airports, and the rare phases are the interesting ones. Tags only where they add something
the altitude colour and vertical rate don't already say.

- [ ] Phases worth detecting, each with the evidence that led to it:
  - [ ] **Holding**: a racetrack pattern (two 180° turns joined by straight legs of about 1 min,
        or 1.5 min above FL140), repeated over the same fix
  - [ ] **Go-around**: descending on an approach at low altitude, then climbing again
  - [ ] **Approach / final**: descending, low, slowing, lined up with a runway
  - [ ] **Levelling off**: approaching the selected altitude (4,0 / TC 29)
  - [ ] **Climb / cruise / descent** as the base layer the others build on
- [ ] Literature: Sun, Ellerbroek, Hoekstra (2017), _Flight extraction and phase identification
      for large automatic dependent surveillance–broadcast datasets_ (fuzzy-logic phases).
- [ ] Tested synthetically (like `weather/circle.ts`), since the capture has none of the rare
      phases. Approach and runway need airport positions: decide on a source (OurAirports is
      public domain; adsbdb's route only names the destination).

## 5. Experiments

Each one starts as a check on the capture. If it doesn't work there, it gets dropped and the
reason written down here.

- [ ] **Coverage**: furthest reception per bearing and altitude band, against the radio horizon
      d ≈ 4.12 (√h_antenna + √h_aircraft) km (4/3-Earth refraction). Needs no antenna height:
      the aircraft term dominates (FL350 gives ~425 km, a 10 m antenna adds ~13 km), and the
      ground elevation at the receiver comes from the terrain tiles already loaded. Terrain
      shadows from a line-of-sight trace over the same tiles. Kept per tab, like everything
      else: the tool isn't meant to run 24/7 and antenna setups are temporary, so coverage
      from an earlier session may not apply anymore. It fills slowly; explain that on the page.
- [ ] **Locating the radars**: a rotating secondary radar interrogates an aircraft when its beam
      points at it. Reply times (12 MHz Beast timestamps) of aircraft whose positions are known
      → rotation period and phase → the radar's position. Catch: Mode S lockout makes DF11
      replies with an interrogator code sparse, so the periods probably have to come from
      roll-call reply bursts. First step: do rotation periods show up in the capture at all?
      Checkable against public radar sites (OpenStreetMap, the national ANSP).
- [ ] **GNSS interference**: where aircraft lose position integrity. With a single receiver
      and data kept per tab, events and dots rather than a heat map. Compare with gpsjam.org,
      which builds its daily map from the same ADS-B fields.
- [ ] **Signal vs distance**: received signal against free-space path loss (20·log₁₀ d) and
      the elevation angle (from altitude and distance: the antenna height changes it by
      hundredths of a degree). Would show the antenna's real pattern, including the weak zone
      overhead. Blocker: `--gain auto` in `pi/readsb.default` shifts the signal scale over time;
      only worth it with a fixed gain.

## 6. Release

- [ ] **License**: decided at the end (likely MIT). All direct dependencies are MIT,
      BSD-3-Clause (MapLibre) or Apache-2.0 (TypeScript); WMM and EGM96 are public domain.
      All decoders are our own; pyModeS (GPL) is only used to verify them.
- [ ] Remove the pyModeS tooling once the decoders are final; the committed oracle output
      can stay as test data or go with it.
- [ ] Credit Junzi Sun (pyModeS, _The 1090 Megahertz Riddle_) in the README.
- [ ] README written for people setting up their own RTL-SDR: setup from zero, what to expect
      depending on where the antenna is.

## Decided against

- **Search**: one antenna sees around 20 aircraft at peak; nothing to search through, and
  nothing is stored to search in.
- **Mode A/C**: Mode S has been required in Europe for IFR and most controlled airspace for
  over a decade, and every Mode S transponder also answers Mode A/C interrogations, so most
  Mode A/C replies would be duplicates of aircraft already seen. They carry no address and no
  CRC, and readsb warns they produce false positives.
- **Second receiver at 1030 MHz** (to hear the interrogations too): extra hardware.
- **Sound alerts**.
