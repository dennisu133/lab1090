/**
 * How far off an ADS-B position may be. Two different questions, two numbers:
 *
 * - Accuracy, NACp (Navigation Accuracy Category, position): the 95 % bound of the error,
 *   the "estimated position uncertainty" (EPU) the navigation system computes. Sent in the
 *   operational status (TC 31) and the target state (TC 29), as a category 0–11.
 * - Integrity, NIC (Navigation Integrity Category) → Rc, the radius of containment: the
 *   circle the true position is guaranteed to be inside, unless the system fails without
 *   noticing, which it may with the probability SIL (e.g. 1e-7 per hour). This is what
 *   ATC separation relies on. Not sent as a number: the position message's type code says
 *   it, refined by supplement bits elsewhere:
 *
 *     version 2 (DO-260B): NIC-A (TC 31), NIC-B (the position message's bit 8), and on
 *                          the ground NIC-C (surface TC 31)
 *     version 1 (DO-260A): one "NIC supplement" (TC 31, where version 2 has NIC-A)
 *     version 0 (DO-260):  no NIC: the type code gives NUCp and its horizontal protection
 *                          limit (HPL), which plays the same part
 *
 * Tables from DO-260B (NIC for airborne and surface positions) and DO-260A for version 1,
 * as pyModeS (_uncertainty.py) and readsb (compute_nic_rc_from_message) lay them out. Radii
 * here are the spec's, in nautical miles where it says so: pyModeS has 14,008 m for 8 NM
 * (14,816 m) and 3,702 m for 2 NM (3,704 m).
 *
 * Supplement combinations the table doesn't define, or that we haven't received yet (no
 * TC 31 so far), give the larger of the candidate radii: never claim more than was said.
 *
 * Shared by server and browser; no state here.
 */

const NM = 1852;

/** NACp → the 95 % accuracy bound (EPU), metres; null for 0, unknown. DO-260B, as pyModeS. */
export const NAC_P_METRES: (number | null)[] = [
	null,
	10 * NM,
	4 * NM,
	2 * NM,
	1 * NM,
	0.5 * NM,
	0.3 * NM,
	0.1 * NM,
	0.05 * NM,
	30,
	10,
	3
];

export interface Containment {
	/** NIC 0–11, or null in version 0 (NUCp instead). */
	nic: number | null;
	/** Radius of containment (version 0: HPL), metres; null if the message says "unknown". */
	rc: number | null;
	/** The radius is the larger of two because a supplement bit is missing. */
	assumed: boolean;
}

export interface Supplements {
	/** ADS-B version from TC 31; null if none received yet. */
	version: number | null;
	/** Version 2: NIC-A. Version 1: the NIC supplement. From TC 31. */
	nicA: number | null;
	/** Version 2: NIC-B, from the position message itself. */
	nicB: number;
	/** Version 2, on the ground: NIC-C, from the surface TC 31. */
	nicC: number | null;
}

/** The containment radius for a position message's type code (5–8, 9–18, 20–22). */
export function containment(tc: number, s: Supplements): Containment | null {
	if (s.version === 0) {
		const hpl = HPL[tc];
		return hpl === undefined ? null : { nic: null, rc: hpl, assumed: false };
	}
	const fixed = FIXED[tc];
	if (fixed) return { nic: fixed[0], rc: fixed[1], assumed: false };

	// The type codes that need supplement bits: two (or three) candidates each.
	const v2 = s.version === 2;
	const a = s.nicA;
	switch (tc) {
		case 11:
			// v2: NIC-A = NIC-B = 1 → NIC 9; both 0 → NIC 8. v1: supplement 1 → 9, 0 → 8.
			if (a === null) return { nic: 8, rc: 0.1 * NM, assumed: true };
			if (v2 ? a === 1 && s.nicB === 1 : a === 1) return { nic: 9, rc: 75, assumed: false };
			return { nic: 8, rc: 0.1 * NM, assumed: v2 && a !== s.nicB };
		case 13:
			// v2: A0 B1 → 0.3 NM, A0 B0 → 0.5 NM, A1 B1 → 0.6 NM. v1: 0 → 0.5 NM, 1 → 0.6 NM.
			if (a === null) return { nic: 6, rc: 0.6 * NM, assumed: true };
			if (!v2) return { nic: 6, rc: (a ? 0.6 : 0.5) * NM, assumed: false };
			if (a === 0) return { nic: 6, rc: (s.nicB ? 0.3 : 0.5) * NM, assumed: false };
			return { nic: 6, rc: 0.6 * NM, assumed: s.nicB === 0 };
		case 16:
			// v2: A1 B1 → NIC 3, 4 NM; A0 B0 → NIC 2, 8 NM. v1: 1 → 4 NM, 0 → 8 NM.
			if (a === null) return { nic: 2, rc: 8 * NM, assumed: true };
			if (v2 ? a === 1 && s.nicB === 1 : a === 1) return { nic: 3, rc: 4 * NM, assumed: false };
			return { nic: 2, rc: 8 * NM, assumed: v2 && a !== s.nicB };
		case 7:
			// Surface. v2: NIC-A 1 (C 0) → NIC 9, 75 m; A 0 → NIC 8, 0.1 NM. v1: the supplement.
			if (a === null) return { nic: 8, rc: 0.1 * NM, assumed: true };
			return a === 1
				? { nic: 9, rc: 75, assumed: false }
				: { nic: 8, rc: 0.1 * NM, assumed: false };
		case 8: {
			// Surface, v2 only: A1 C1 → NIC 7, 0.2 NM; A1 C0 → NIC 6, 0.3 NM; A0 C1 → NIC 6, 0.6 NM.
			const c = s.nicC;
			if (!v2 || a === null || c === null) return { nic: 0, rc: null, assumed: false };
			if (a === 1 && c === 1) return { nic: 7, rc: 0.2 * NM, assumed: false };
			if (a === 1) return { nic: 6, rc: 0.3 * NM, assumed: false };
			if (c === 1) return { nic: 6, rc: 0.6 * NM, assumed: false };
			return { nic: 0, rc: null, assumed: false };
		}
	}
	return null;
}

/** Type codes whose NIC needs no supplement: [NIC, Rc in metres or null for unknown]. */
const FIXED: Record<number, [number, number | null]> = {
	5: [11, 7.5],
	6: [10, 25],
	9: [11, 7.5],
	10: [10, 25],
	12: [7, 0.2 * NM],
	14: [5, 1 * NM],
	15: [4, 2 * NM],
	17: [1, 20 * NM],
	18: [0, null],
	20: [11, 7.5],
	21: [10, 25],
	22: [0, null]
};

/** Version 0: type code → NUCp → HPL, metres (DO-260, as pyModeS's NUCp table). */
const HPL: Record<number, number | null> = {
	5: 7.5,
	6: 25,
	7: 185,
	8: 370,
	9: 7.5,
	10: 25,
	11: 185,
	12: 370,
	13: 926,
	14: 1852,
	15: 3704,
	16: 18_520,
	17: 37_040,
	18: null,
	20: 7.5,
	21: 25,
	22: null
};
