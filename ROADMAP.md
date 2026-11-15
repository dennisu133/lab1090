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

- [ ] **On the page**: banner, the aircraft highlighted on the map and in the list, a marker in
      the tab title (for a window left open on a second screen).
- [ ] **System notifications**, opt-in, via the Notification API from the open tab (no push
      server, no service worker). Browsers only allow it in a secure context (HTTPS or
      `localhost`), so it can't be required: explain that where the switch is.
- [ ] **Triggers**, each with an explanation of what it means and what happens next:
  - [ ] Squawk 7500 / 7600 / 7700
  - [ ] TC 28 subtype 1 emergency states (general, medical, minimum fuel, no communications,
        unlawful interference, downed aircraft)
  - [ ] ACAS resolution advisories (TC 28 subtype 2, register 3,0, DF16)
  - [ ] An aircraft losing GNSS integrity (NACp / NIC dropping to 0), see phase 5
- [ ] Tests with synthetic frames; a way to play them through `tools/replay.ts` to see the UI.

## 3. Weather on the map and in the air

- [ ] **Wind barbs on the tracker map**: the per-aircraft winds drawn where they were measured.
      A new switch in `MapLayers`.
- [ ] **Barometric vs inertial vertical rate** (both in register 6,0, both decoded already).
      The autopilot holds _pressure_ altitude, so in level flight the inertial rate shows the
      pressure surface tilting: the same physics as `geostrophic.ts`, seen from another side.
      Vertical gusts and mountain waves show up in both; the static system's lag shows as the
      barometric rate trailing the inertial one. Second source: TC 19's GNSS − baro difference
      over time.
- [ ] **Contrails** (Schmidt–Appleman criterion): from the measured temperature at each level,
      the altitude above which engines leave contrails. Humidity is almost never known (4,4 is
      rare), so show it as a range: threshold at 0 % and at 100 % relative humidity. Whether
      contrails _persist_ (ice supersaturation) can't be known; say so.
  - [ ] On /weather "Now": a line in the profile.
  - [ ] In the aircraft panel: "probably leaving a contrail", with the reasoning. The part
        anyone can check by looking up.

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
