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
  - [ ] An aircraft losing GNSS integrity (NACp / NIC dropping to 0): moved to phase 4's GNSS
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

## 4. Experiments

Each one starts as a check on the capture. If it doesn't work there, it gets dropped and the
reason written down here.

- [ ] **Coverage**: furthest reception per bearing and altitude band, against the radio horizon
      d ≈ 4.12 (√h_antenna + √h_aircraft) km (4/3-Earth refraction). Needs no antenna height:
      the aircraft term dominates (FL350 gives ~425 km, a 10 m antenna adds ~13 km), and the
      ground elevation at the receiver comes from the terrain tiles already loaded. Terrain
      shadows from a line-of-sight trace over the same tiles. Kept per tab, like everything
      else: the tool isn't meant to run 24/7 and antenna setups are temporary, so coverage
      from an earlier session may not apply anymore. It fills slowly; explain that on the page.
      First look at the capture (10 min, 16 aircraft with positions): the farthest is 193 km
      at FL350, 45 % of its 425 km horizon, so the signal limits this receiver, not the
      Earth's curvature; the farthest aircraft gave only 1–2 positions each; nothing at all
      between 50° and 170°, a shadow or just no traffic. Needs ~1 h of busy-time recording to
      tell; where tracks end (in cruise, flying away) could separate the two.
- [x] **Locating the radars**: a rotating secondary radar interrogates an aircraft when its beam
      points at it. Reply times (12 MHz Beast timestamps) of aircraft whose positions are known
      → rotation period and phase → the radar's position. Catch: Mode S lockout makes DF11
      replies with an interrogator code sparse, so the periods probably have to come from
      roll-call reply bursts. First step: do rotation periods show up in the capture at all?
      Checkable against public radar sites (OpenStreetMap, the national ANSP).
      First check on the capture: yes, and lockout isn't the problem. DF11 replies carry 60+
      different II/SI codes; each code's replies come in bursts (a few replies within 10–40 ms,
      the beam sweeping past) at a steady period per code, the same for every aircraft:
      SI44 5.000 s, SI17 4.878, SI28 3.957, SI33 3.998, SI35 10.03. Each burst is the moment
      the beam points at an aircraft whose ADS-B position is known, so the radar's position,
      phase and direction can be fitted (errors capped at 10°, so a few stray bursts don't
      pull it). Five codes fit: median 0.4–1.1°, 94–100 % of bursts within 5°, all clockwise
      (the other direction fits far worse). Leaving one aircraft out moves SI44 (216 km away)
      by ≤ 2 km, SI17/SI28/SI33 (360–440 km) by ≤ 17 km, SI35 (10 s, fewer bursts) by up to
      60 km. SI60 and II1 mix two periods (4.7 and 5.0 s), probably two radars sharing a
      code: no fit yet. Compared with radar sites from OpenStreetMap and the ANSPs: SI44 is
      0.9 km from the radar at Neubrandenburg-Trollenhagen airfield, SI33 2.9 km from Austro
      Control's Feichtberg station, SI28 8.2 km from LPS SR's secondary radar on Veľký
      Javorník, SI17 5.9 km from PANSA's new PSR/MSSR tower at Sączów near Katowice (in
      service since March 2026), SI35 maybe the military long-range radar post at Wronowice
      (~9 km; nothing confirms the code). The errors grow with distance, as leaving
      aircraft out predicted.
  - [x] Built (`src/lib/radar/`): in the browser, per tab, first on the tracker map with an
        uncertainty ellipse (jackknife over aircraft, 2 standard errors) and the beam sweeping
        as the fit predicts; tap for a panel with every step. Two things the first check
        missed: SI 60 is a Mode S cluster (two radars, one code, the same 5 s period at
        different phases), so the period comes from a sharp comb that ignores the gaps between
        the two, the phase from the densest cluster, and the final position from a sharp score
        (with the capped one, a phantom between the two won); synthetic clusters are found
        within 1 km, the capture's SI 60 is too thin (two aircraft). With the final method:
        SI 44 0.3 km, SI 33 2 km, SI 35 7 km, SI 17 8 km, SI 28 11 km from the mapped sites;
        all inside their ellipses but SI 17 (1.7×, across: maybe the older radar at the
        airport). Shuffled burst times give none. Radars appear after 4–10 min.
  - [x] **Moved to `/experimental/radars`**, off the tracker map. After a longer run on the
        dev server, the map was full of radars that weren't there: eight on SI 52 (all 4.0 s,
        hundreds of km apart), two SI 35 near Łódź, SI 12 and SI 1 with ellipses well over
        100 km long. Two causes. A radar once found stayed for good, and each new fit more than 60 km from the
        last counted as another one, so every lucky fit added a radar. And the gates only
        asked whether a fit explains bursts, not whether it pins a place down: at a 4 s
        period with enough bursts, a long line of places explains 40 %. Now:
    - an ellipse gate: semi-major axis ≤ 50 km (2 SE). Capture: SI 44 5–13 km, SI 17 13–56,
      SI 28 39–102, SI 33 33, SI 35 130–306. So SI 35 is never placed: its fits landed
      4–44 km from Wronowice only because the site lies on that line.
    - confirmation: a new fit is a candidate (listed, not drawn) until every fit has found
      it again for 2 min; one miss and it's gone. A confirmed radar goes after 3 fits in a
      row that find other radars on its code but not it; fits that find nothing (too few
      aircraft: a restart, thin traffic) don't count against it. A second radar on a code
      must stand > 60 km from the first (a cluster's radars are different sites).
    - On the capture: SI 44 and SI 17 confirmed (6.3 and 7.5 min), SI 28 and SI 33
      candidates at the end (found at 9.3 and 9.6 min); same positions as before. Played
      3× in a row like `replay.ts --loop` (the clock restarts): the confirmed ones stay,
      candidates come and go, nothing else shows. With timestamps run on across the seams
      instead (every radar's phase jumps, which can't happen live): before the 60 km rule
      a ghost "SI 44 b" at SI 44's site; after it, only short-lived candidates.
    - Starts when the page is first opened (~2–4 s CPU per 10 min, more than all other
      views together), then runs on every page until the tab closes.
  - [ ] An hour of live traffic on the new page: are the phantoms gone, and do the real
        radars survive? If yes, back on the tracker map (a layer switch, off by default).
  - [ ] Check on a longer recording: whether a period stays steady beyond 10 minutes (the
        window), and whether the clusters separate with more aircraft.
  - [ ] Maybe later: roll-call replies (DF4/5/20/21, most of the traffic) assigned to a
        radar by its predicted beam, for more bursts per turn.
- [ ] **GNSS interference**: where aircraft lose position integrity. With a single receiver
      and data kept per tab, events and dots rather than a heat map. Compare with gpsjam.org,
      which builds its daily map from the same ADS-B fields.
- [ ] **Signal vs distance**: received signal against free-space path loss (20·log₁₀ d) and
      the elevation angle (from altitude and distance: the antenna height changes it by
      hundredths of a degree). Would show the antenna's real pattern, including the weak zone
      overhead. Blocker: `--gain auto` in `pi/readsb.default` shifts the signal scale over time;
      only worth it with a fixed gain.

## 5. Release

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
- **Flight phase tags** (holding, go-around, approach): climb, cruise and
  descent can already be read from the altitude-coloured trail, and the basic trend is in
  the panel (`src/lib/tracker/phase.ts`). The interesting phases are the rare ones, and
  there's no data to build and check them against: this receiver mostly sees cruise
  traffic, the capture has none of them, and synthetic ones would only test our own idea of
  what they look like. Sun, Ellerbroek, Hoekstra (2017), _Flight extraction and phase
  identification for large automatic dependent surveillance–broadcast datasets_ (fuzzy-logic
  phases) was tried for the basic phases and not used.
