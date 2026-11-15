/**
 * How far off an aircraft's position may be, from what it says about it (lib/modes/
 * integrity.ts): the 95 % accuracy (NACp) and the containment radius (NIC → Rc). The map
 * draws both as circles, the panel explains them.
 *
 * Shared by server and browser; no state here.
 */
import { containment, NAC_P_METRES, type Containment } from '#lib/modes/integrity.ts';
import type { TrackedAircraft } from './tracker';

export interface Uncertainty {
	nacP: number | null;
	/** The 95 % accuracy bound, metres; null if unknown (NACp 0, or none received). */
	accuracy: number | null;
	/** From the latest position message; null without one. */
	containment: Containment | null;
	/** SIL 0–3 and per hour (0) or per sample (1); null without TC 31. */
	sil: number | null;
	silSupplement: number | null;
}

export function uncertainty(a: TrackedAircraft): Uncertainty {
	const op = a.operational?.value ?? null;
	const code = a.positionCode?.value;
	const nacP = a.nacP?.value ?? null;
	return {
		nacP,
		accuracy: nacP === null ? null : (NAC_P_METRES[nacP] ?? null),
		containment: code
			? containment(code.tc, {
					version: op?.version ?? null,
					nicA: op?.nicA ?? null,
					nicB: code.nicB,
					nicC: op?.nicC ?? null
				})
			: null,
		sil: op?.sil ?? null,
		silSupplement: op?.silSupplement ?? null
	};
}
