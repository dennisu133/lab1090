import { defineEnvVars } from '@sveltejs/kit/env';
import { parseLatLon } from '#lib/geo.ts';

export const variables = defineEnvVars({
	RECEIVER_HOST: {
		description: 'Host running readsb with Beast output (default: pi)',
		schema: (value) => value || 'pi'
	},
	RECEIVER_PORT: {
		description: 'readsb Beast output port (default: 30005)',
		schema: (value) => {
			const port = Number(value || 30005);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				throw new Error(`expected a TCP port, got "${value}"`);
			}
			return port;
		}
	},
	RECEIVER_POSITION: {
		description:
			'Where the antenna is, as "latitude,longitude" (decimal degrees), e.g. "51.5,-0.1". ' +
			'Required, and as exact as you can (~100 m): the reference for decoding positions, ' +
			"the tracker's range check, distances, the map and the coverage.",
		schema: parseLatLon
	}
});
