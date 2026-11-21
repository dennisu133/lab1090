/**
 * Is this position from working satellite navigation? Judged per ADS-B position message,
 * from what the aircraft itself says about the position (modes/integrity.ts):
 *
 * - NIC → Rc, the radius of containment (from the type code and the supplement bits), and
 * - NACp, the 95 % accuracy bound (from the latest TC 31 or TC 29).
 *
 * An airliner navigating by GNSS reports NIC 7–11 and NACp 8–11: Rc under 0.2 NM, the
 * accuracy under 0.05 NM, often 10 m. Those are the minimums ADS-B Out must meet to count as
 * equipped in US airspace (FAA 14 CFR 91.227(c)(1): NACp < 0.05 NM, NIC < 0.2 NM). Below
 * either, the position isn't from GNSS any more, or the GNSS receiver no longer vouches for
 * it: the flight management system goes on from the inertial reference (gyros
 * and accelerometers, drifting a mile or two an hour) or radio beacons (DME), and the
 * transponder sends that, with a NIC to match. The same happens when a receiver can't
 * track the satellites at all because something on the ground drowns their signal
 * (jamming), and partly when false signals make the receiver's own checks fail (spoofing).
 *
 * Three states:
 *
 *   good      Rc ≤ 0.2 NM and NACp ≥ 8 (or no NACp received yet: judged by NIC alone)
 *   degraded  a position, but worse than that (TC 18: NIC 0, "integrity unknown"; or a
 *             large Rc, or NACp < 8, 0 meaning unknown)
 *   none      TC 0: an airborne position message without a position, only the altitude
 *
 * In an hour of traffic (fixtures/local/capture-1h.beast, 96 aircraft sending positions),
 * no aircraft ever switched between the states: 92 were good throughout, three sent TC 18
 * with NACp 0 throughout (MAS4, CKK235, CCA935, all from the east), one TC 0 only
 * (a military flight). In the 10-minute capture: DLH895 TC 18, CCA749 TC 0. So the numbers
 * don't flicker around the line: a change of state means something changed.
 *
 * Version 0 (DO-260) aircraft send no NIC: the type code's NUCp gives a protection limit
 * (HPL) instead, held to the same 0.2 NM; they send no NACp either.
 *
 * Shared by server and browser; no state here.
 */
import { containment } from '#lib/modes/integrity.ts';
import { NM } from '#lib/units.ts';

export type Navigation = 'good' | 'degraded' | 'none';

/** The largest radius of containment that counts as good, metres (NIC 7). */
export const MAX_RC_M = 0.2 * NM;
/** The smallest NACp that counts as good (NACp 8: under 0.05 NM, 93 m). */
export const MIN_NAC_P = 8;

export interface Judgement {
	state: Navigation;
	/** The type code it was judged from. */
	tc: number;
	/** NIC 0–11 (null in version 0, or for TC 0). */
	nic: number | null;
	/** Rc, metres (version 0: HPL); null: unknown, or TC 0. */
	rc: number | null;
	nacP: number | null;
}

/** What the aircraft said in its operational status (TC 31) that the NIC needs; null: none yet. */
export interface Supplement {
	version: number;
	nicA: number | null;
}

/**
 * An airborne position message's verdict: its type code (0, 9–18, 20–22) and NIC-B bit,
 * with the aircraft's latest TC 31 and NACp. null for other type codes.
 */
export function judge(
	tc: number,
	nicB: number,
	operational: Supplement | null,
	nacP: number | null
): Judgement | null {
	if (tc === 0) return { state: 'none', tc, nic: null, rc: null, nacP };
	if (!((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22))) return null;
	const c = containment(tc, {
		version: operational?.version ?? null,
		nicA: operational?.nicA ?? null,
		nicB,
		nicC: null
	});
	const rc = c?.rc ?? null;
	const good = rc !== null && rc <= MAX_RC_M && (nacP === null || nacP >= MIN_NAC_P);
	return { state: good ? 'good' : 'degraded', tc, nic: c?.nic ?? null, rc, nacP };
}
