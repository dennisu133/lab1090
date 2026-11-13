import { defineEnvVars } from '@sveltejs/kit/env';

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
	}
});
