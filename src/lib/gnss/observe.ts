/**
 * From the tracker to the watch: an ADS-B airborne position message, judged
 * (navigation.ts), with where the tracker put the aircraft for it.
 *
 * `a` is the tracker's snapshot after the message, or after a later one: the live view
 * (routes/gnss-stream.svelte.ts) gets a snapshot per update (four a second), not per
 * message. The type code and NIC-B come from the message itself; the supplement and NACp
 * from the snapshot (they change rarely); the position only if it's the one this message
 * gave (its time is the message's).
 */
import { bits } from '#lib/modes/frame.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import { judge } from './navigation';
import type { Observation } from './watch';

/** `data`: a DF17 with a valid CRC from `a`; `t` its time, ms. null: not an airborne position. */
export function observe(a: TrackedAircraft, data: Uint8Array, t: number): Observation | null {
	// The ME field starts at bit 33: TC (5) | SS (2) | NIC-B (1).
	const op = a.operational?.value ?? null;
	const judgement = judge(bits(data, 33, 5), bits(data, 40, 1), op, a.nacP?.value ?? null);
	if (!judgement) return null;
	const p = a.position;
	const position = p && p.t === t && !p.surface && a.confirmed ? { lat: p.lat, lon: p.lon } : null;
	return {
		icao: a.icao,
		t,
		judgement,
		position,
		altitude: a.altitude?.value ?? null,
		callsign: a.callsign?.value ?? null
	};
}
