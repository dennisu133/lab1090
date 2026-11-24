/**
 * Which page is this: compare `page.url.pathname` with `pathOf(resolve(…))`, never with
 * `resolve(…)` itself. On the server `resolve()` gives relative links (SvelteKit's
 * `paths.relative`: `./frames`, or `../frames` from /weather/aircraft), in the browser
 * absolute ones, while `page.url.pathname` is always absolute. Compared as they were, the
 * server's page matched no page: no current page in the navigation, and no "made for wide
 * screens" notice until the JavaScript ran, which then pushed the whole page down.
 */
import { page } from '$app/state';

/** The absolute path a link leads to from the current page, as the browser follows it. */
export function pathOf(href: string): string {
	return new URL(href, page.url.href).pathname;
}
