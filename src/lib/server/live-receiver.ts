import { building } from '$app/env';
import { RECEIVER_HOST, RECEIVER_PORT } from '$app/env/private';
import { Receiver } from './receiver';

/**
 * The one Receiver instance of this server process.
 *
 * This module body runs when the server starts and, in dev, again whenever this file or one
 * of its imports is edited (Vite hot reload). A plain module-level `new Receiver()` would then
 * open a second, third, … connection to the Pi while the old ones keep running. So the
 * instance lives on globalThis, which survives reloads: stop the old one, start a new one
 * running the new code. Open browser tabs get disconnected and reconnect by themselves.
 */
const g = globalThis as typeof globalThis & { __adsbReceiver?: Receiver };

if (!building) {
	g.__adsbReceiver?.stop();
	g.__adsbReceiver = new Receiver(RECEIVER_HOST, RECEIVER_PORT).start();
}

export function receiver(): Receiver {
	if (!g.__adsbReceiver) throw new Error('Receiver is not running (are we building?)');
	return g.__adsbReceiver;
}
