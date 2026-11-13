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
	REFERENCE_POINT: {
		description:
			'A point near the receiver as "latitude,longitude" (decimal degrees), e.g. "51.5,-0.1". ' +
			'Used to decode single ADS-B positions (local CPR decoding): it only has to be within ' +
			'~150 NM of the aircraft, so a rounded value is enough. Optional.',
		schema: parseLatLon
	}
});
