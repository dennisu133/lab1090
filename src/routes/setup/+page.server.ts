import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { parseLatLon } from '#lib/geo.ts';
import { receiver } from '#lib/server/live-receiver.ts';
import { settings } from '#lib/server/live-settings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	position: settings.position,
	/** Set with --position: shown, not changeable here. */
	fixed: settings.positionFrom === 'flag',
	configPath: settings.configPath
});

export const actions: Actions = {
	/**
	 * Save the position (the page only offers it once it's exact enough) and go to the map.
	 * Every open tab's stream ends; they reconnect, see the new position and reload.
	 */
	default: async ({ request }) => {
		if (settings.positionFrom === 'flag') {
			return fail(409, { error: 'The position is set with --position; change it there.' });
		}
		const form = await request.formData();
		let position;
		try {
			position = parseLatLon(`${form.get('lat')},${form.get('lon')}`);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		try {
			settings.setPosition(position);
		} catch (e) {
			return fail(500, { error: `Couldn’t save it: ${(e as Error).message}` });
		}
		receiver().disconnectAll();
		redirect(303, resolve('/(app)'));
	}
};
