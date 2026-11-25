/**
 * A jammer that never was: the capture's messages rewritten as if a GNSS jammer stood on the
 * ground at JAMMER, so the GNSS layer (watch.ts) and its panel can be seen working. Neither
 * recording has any interference: no aircraft in them changes state (navigation.ts).
 *
 * Used by the tests (watch.test.ts) and by `bun tools/replay.ts --jamming`. Never imported by
 * the app.
 *
 * Every aircraft within JAMMED_KM of the jammer (a plain circle on the ground: a real one's
 * edge depends on the aircraft's height, the terrain and the antennas) loses its GNSS, and
 * gets it back REACQUIRE_S after leaving the circle: a receiver needs a while to find the
 * satellites again. While jammed, its messages say so the two ways transponders do:
 *
 * - Aircraft with an even address keep sending positions (from their inertial reference):
 *   the airborne position's type code becomes 18 (NIC 0: integrity unknown), the position
 *   itself stays.
 * - Aircraft with an odd address send no position: type code 0, the altitude only.
 *
 * and their NACp (TC 31 airborne, TC 29 subtype 1) becomes 0, unknown. Aircraft already
 * degraded (DLH895 sends TC 18 throughout) stay as they are. Which aircraft is where comes
 * from the capture itself, through the tracker. In the 10-minute capture, nine aircraft cross
 * the circle, two of them twice.
 */
import { Tracker } from '#lib/tracker/tracker.ts';
import { put, withCrc } from '#lib/tracker/alert-scenario.ts';
import { distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { bits, downlinkFormat, toHex } from '#lib/modes/frame.ts';
import type { BeastFrame } from '#lib/beast/parser.ts';

/** Where it stands: 33 km south of the tests' receiver (52, 14), where the capture's traffic is. */
export const JAMMER: LatLon = { lat: 51.7, lon: 14.0 };
/** How far it reaches, km. */
export const JAMMED_KM = 50;
/** How long a receiver takes to find the satellites again after leaving, s. */
export const REACQUIRE_S = 30;

/** 12 MHz Beast ticks per ms. */
const TICKS_PER_MS = 12_000;
/** A position older than this doesn't say where the aircraft is now, ms. */
const POSITION_MS = 30_000;

/** The recording with the jammer in it. `receiver`: for the tracker's range check. */
export function injectJamming(
	frames: BeastFrame[],
	receiver: LatLon = { lat: 52, lon: 14 }
): BeastFrame[] {
	const positions = track(frames, receiver);
	/** When each aircraft was last inside the circle, ms. */
	const inside = new Map<string, number>();
	const latest = new Map<string, number>();
	return frames.map((f) => {
		if (f.kind === 'modeac' || downlinkFormat(f.data) !== 17) return f;
		const icao = toHex(f.data.subarray(1, 4)).toUpperCase();
		const t = f.timestamp / TICKS_PER_MS;
		const list = positions.get(icao) ?? [];
		// The latest known position at t (the list is in time order).
		let i = latest.get(icao) ?? 0;
		while (i + 1 < list.length && list[i + 1].t <= t) i++;
		latest.set(icao, i);
		const p = list[i];
		if (p && p.t <= t && t - p.t <= POSITION_MS && distanceKm(p, JAMMER) < JAMMED_KM)
			inside.set(icao, t);
		const last = inside.get(icao);
		if (last === undefined || t - last > REACQUIRE_S * 1000) return f;
		const data = jammed(f.data, parseInt(icao, 16) % 2 === 1);
		return data ? { ...f, data } : f;
	});
}

/** A DF17's message as the jammed aircraft sends it; null: unchanged. */
function jammed(original: Uint8Array, noPosition: boolean): Uint8Array | null {
	const data = original.slice();
	// The ME field starts at bit 33 of the message.
	const tc = bits(data, 33, 5);
	if (tc >= 9 && tc <= 17) {
		if (noPosition) {
			put(data, 33, 5, 0);
			put(data, 40, 1, 0); // NIC-B
			put(data, 53, 36, 0); // T, F and the CPR position
		} else {
			put(data, 33, 5, 18);
			put(data, 40, 1, 0);
		}
	} else if (tc === 31 && bits(data, 38, 3) === 0 && bits(data, 73, 3) >= 1) {
		put(data, 76, 1, 0); // NIC-A
		put(data, 77, 4, 0); // NACp
	} else if (tc === 29 && bits(data, 38, 2) === 1) {
		put(data, 72, 4, 0); // NACp
	} else return null;
	return withCrc(data);
}

/** Every confirmed airborne position of each aircraft in the capture, in time order. */
function track(frames: BeastFrame[], receiver: LatLon): Map<string, (LatLon & { t: number })[]> {
	const tracker = new Tracker(() => receiver);
	const filter = new AddressFilter();
	const out = new Map<string, (LatLon & { t: number })[]>();
	for (const f of frames) {
		if (f.kind === 'modeac') continue;
		const t = f.timestamp / TICKS_PER_MS;
		const addr = filter.check(f.data, t);
		if (!tracker.add(f.data, addr, t)) continue;
		const a = tracker.get(addr!.icao)!;
		if (a.position?.t !== t || a.position.surface || !a.confirmed) continue;
		const list = out.get(a.icao) ?? [];
		list.push({ t, lat: a.position.lat, lon: a.position.lon });
		out.set(a.icao, list);
	}
	return out;
}
