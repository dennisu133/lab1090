/**
 * System notifications for alerts, opt-in: the operating system's own pop-ups (Notification
 * API), shown by the open tab. No push server and no service worker, so it only works while
 * the tab is open, and only on desktop browsers: Chrome on Android refuses `new
 * Notification()` without a service worker, and iOS only allows it for apps added to the home
 * screen. A phone's browser also stops the stream of a tab in the background anyway.
 *
 * Two switches must both be on:
 *
 * - ours (`wanted`, remembered in localStorage): off until the user turns it on, and they
 *   can turn it off again at any time;
 * - the browser's permission, which it asks for the first time ours is turned on, and never
 *   again on its own. Once refused ('denied'), only the user can change it, in the site
 *   settings (the icon left of the address); asking again would be refused straight away.
 *   A site can't take a permission back either, which is why ours exists.
 *
 * Browsers only allow notifications in a secure context: HTTPS, or `localhost`. Opened from
 * another machine over plain HTTP (http://pi:1090), the switch can't work, and says so.
 */

/** What the browser allows: its permission, or why there's none to ask for. */
export type Permission = NotificationPermission | 'insecure' | 'unsupported';

const KEY = 'alerts.notify';

export class SystemNotifications {
	/** Our switch. */
	wanted = $state(false);
	permission = $state<Permission>('unsupported');

	/** Both switches on: notifications will show. */
	get on(): boolean {
		return this.wanted && this.permission === 'granted';
	}

	/** In the browser, once: read our switch and the browser's permission, and follow it. */
	start(): void {
		this.wanted = localStorage.getItem(KEY) === 'on';
		if (!('Notification' in window)) return;
		if (!window.isSecureContext) {
			this.permission = 'insecure';
			return;
		}
		this.permission = Notification.permission;
		// The user can change it in the site settings while the page is open.
		navigator.permissions?.query({ name: 'notifications' }).then(
			(status) => {
				status.onchange = () => (this.permission = Notification.permission);
			},
			() => {}
		);
	}

	/** The switch was clicked. Asks the browser for permission the first time only. */
	async toggle(): Promise<void> {
		if (this.on) return this.#set(false);
		if (this.permission === 'default') this.permission = await Notification.requestPermission();
		// Refused or dismissed: ours stays off. Dismissed ('default') may be asked again on the
		// next click, but only then.
		this.#set(this.permission === 'granted');
	}

	#set(on: boolean): void {
		this.wanted = on;
		localStorage.setItem(KEY, on ? 'on' : 'off');
	}

	/**
	 * Show one, if switched on and the window isn't the one in use: with the page in front of
	 * the user, the banner is enough. `tag`: a notification with the same tag replaces the
	 * last one instead of piling up. `onclick`: after bringing the tab to the front.
	 */
	show(title: string, body: string, tag: string, onclick: () => void): void {
		if (!this.on || document.hasFocus()) return;
		try {
			const n = new Notification(title, { body, tag });
			n.onclick = () => {
				window.focus();
				onclick();
				n.close();
			};
		} catch {
			// A browser that only allows them from a service worker (Chrome on Android).
		}
	}
}
