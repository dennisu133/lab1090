import { building } from '$app/env';
import { settings } from './live-settings';
import { Receiver } from './receiver';

/**
 * The one Receiver instance of this server process.
 *
 * This module body runs when the server starts and, in dev, again whenever this file or one
 * of its imports is edited (Vite hot reload). A plain module-level `new Receiver()` would then
 * open a second, third, … connection to the receiver while the old ones keep running. So the
 * instance lives on globalThis, which survives reloads: stop the old one, start a new one
 * running the new code. Open browser tabs get disconnected and reconnect by themselves.
 */
const g = globalThis as typeof globalThis & { __lab1090Receiver?: Receiver };

if (!building) {
	g.__lab1090Receiver?.stop();
	g.__lab1090Receiver = new Receiver(settings.source, { beastOut: settings.beastOut }).start();
}

export function receiver(): Receiver {
	if (!g.__lab1090Receiver) throw new Error('Receiver is not running (are we building?)');
	return g.__lab1090Receiver;
}
