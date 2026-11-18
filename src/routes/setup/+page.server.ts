import { settings } from '#lib/server/live-settings.ts';
import type { PageServerLoad } from './$types';

/** Saving goes to /api/position (see there for why it isn't a form action). */
export const load: PageServerLoad = () => ({
	position: settings.position,
	/** Set with --position: shown, not changeable here. */
	fixed: settings.positionFrom === 'flag',
	configPath: settings.configPath
});
