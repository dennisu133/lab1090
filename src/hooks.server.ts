import { networkInterfaces } from 'node:os';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { receiver } from '#lib/server/live-receiver.ts';
import { settings } from '#lib/server/live-settings.ts';

/** Start reading the receiver when the server starts, not on the first request. */
export const init: ServerInit = () => {
	if (building) return;
	console.log(`Receiving from ${receiver().source}`);

	// --port and --bind: adapter-bun reads PORT and HOST once this hook is done, just before
	// it starts listening. (Vite's dev server has its own port.)
	if (!dev) {
		process.env.PORT = String(settings.port);
		if (settings.bind) process.env.HOST = settings.bind;
		else delete process.env.HOST;
		// The adapter only says "localhost"; on a Pi without a screen, the page is opened from
		// another device, so name this machine's network addresses too.
		const hosts = settings.bind ? [settings.bind] : ['localhost', ...lanAddresses()];
		console.log(`Open ${hosts.map((h) => `http://${h}:${settings.port}`).join(' or ')}`);
	}

	// Production (`bun ./build`): on SIGTERM/SIGINT the adapter stops accepting requests and
	// waits for open ones to finish, then exits once nothing keeps the event loop busy. But
	// the event streams to open tabs never finish on their own, and the connection to the Pi
	// and the batch timer keep the loop busy forever. So stop the receiver right away: that
	// closes every stream (the wait ends at once) and the connection, and the process exits.
	// Not in dev: Vite has its own Ctrl+C handling, and a listener here would override the
	// default exit.
	if (!dev) {
		for (const signal of ['SIGTERM', 'SIGINT'] as const) {
			process.once(signal, () => receiver().stop());
		}
	}
};

/** This machine's IPv4 addresses on the network (not loopback). */
function lanAddresses(): string[] {
	return Object.values(networkInterfaces())
		.flat()
		.filter((a) => a && a.family === 'IPv4' && !a.internal)
		.map((a) => a!.address);
}
