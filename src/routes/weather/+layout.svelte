<!--
	/weather: the shared header and the tabs. The WeatherStream belongs to the root layout
	(routes/streams.ts), so it collects all the time: "Now" needs up to half an hour of data.

	- Now (/weather): the air above the receiver, from all aircraft together.
	- Per aircraft (/weather/aircraft): each aircraft's wind and temperature, worked through.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { MAX_ROLL, MAX_SKEW_MS } from '#lib/weather/observation.ts';

	let { children } = $props();

	const tabs = [
		{ route: '/weather', href: resolve('/weather'), label: 'Now' },
		{ route: '/weather/aircraft', href: resolve('/weather/aircraft'), label: 'Per aircraft' }
	];
</script>

<div class="space-y-6">
	<header
		class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm"
	>
		<div class="text-zinc-400">
			<InfoTip label="Weather from aircraft?" wide>
				<p>
					Every airliner carries a small weather station: probes for air pressure and temperature,
					and a navigation system that knows its true path over the ground. Nobody sends us the
					weather, but radars read the aircraft's speeds and heading for air traffic control, in
					registers
					<strong>5,0</strong> and <strong>6,0</strong> (see /comm-b). Those are enough to work out the
					wind and the temperature at the aircraft, for every aircraft the radars talk to.
				</p>
				<p>
					The <strong>Now</strong> tab adds what aircraft broadcast themselves via ADS-B: the gap between
					their GNSS height and their barometric altitude (it shows how warm the whole air column below
					them is), and the pressure their altimeters are set to.
				</p>
				<p>
					Weather services do exactly this. The Dutch weather service (KNMI) turns the replies
					collected by the air traffic control radars around Amsterdam into wind and temperature
					observations and feeds them into its forecasts: far more of them than weather balloons
					(twice a day, at a few stations) or the reports airlines send themselves (AMDAR) give.
				</p>
				<p class="text-zinc-400">
					Sources: S. de Haan, "High-resolution wind and temperature observations from aircraft
					tracked by Mode-S air traffic control radar", Journal of Geophysical Research (2011). J.
					Sun et al., "Weather field reconstruction using aircraft surveillance data and a novel
					meteo-particle model", PLOS ONE (2018), by the author of pyModeS.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="Which replies count" wide>
				<p>
					Only Comm-B replies with a <strong>verified address</strong> ("known" on /frames). A corrupted
					reply looks like it came from a different, made-up aircraft; its numbers would make up a wind.
				</p>
				<p>
					Only registers inferred as <strong>5,0 or 6,0</strong> that nothing the aircraft broadcast via
					ADS-B contradicts (see /comm-b for how). A 6,0 mistaken for a 5,0 would turn a Mach number into
					a ground speed.
				</p>
				<p>
					Each new 5,0 is paired with the aircraft's latest 6,0 and the other way round. The pair is
					an
					<strong>observation</strong>. Its wind is <strong>trusted</strong> if:
				</p>
				<ul class="list-disc space-y-1 pl-5">
					<li>
						the two replies are at most {MAX_SKEW_MS / 1000} s apart, so they describe the same moment,
						and
					</li>
					<li>
						the aircraft banks at most {MAX_ROLL}°. In a turn the heading changes by up to 3° per
						second, and every degree is 8 kt of made-up crosswind. (Without a roll angle in 5,0, its
						track rate decides.)
					</li>
				</ul>
				<p>
					The temperature only needs the first: it doesn't depend on the heading, so turns don't
					matter.
				</p>
				<p class="text-zinc-400">
					Both thresholds come from this receiver's data: in straight flight the wind hardly changed
					with the time between the replies; in turns, 1–3 s apart scattered it by ±10 kt.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="How accurate?" wide align="right">
				<p>
					<strong>Rounding</strong>, which we can calculate: the registers round speeds to 2 kt,
					angles to 0.18° and Mach to 0.004. Every value here shows the range that allows: typically
					±2 kt and ±2° for the wind, ±2 K for the temperature at cruise. The one-minute averages
					are better.
				</p>
				<p>
					<strong>Heading</strong>, which we can't: the aircraft converts its true heading to
					magnetic with its own table of the declination, which may be years older than our World
					Magnetic Model. Every 1° of difference is 8 kt of crosswind. Weather services correct this
					per aircraft, against forecasts; we don't have a forecast to compare with.
				</p>
				<p>
					<strong>Timing</strong>: the radar reads whatever was in the register, which the avionics
					update a few times a second. Fine in straight flight, which is why turns are left out.
				</p>
				<p class="text-zinc-400">
					So: trust the averages to a few knots and a degree or two, and wind directions to a few
					degrees. Agreement between aircraft at the same level is the best check.
				</p>
			</InfoTip>
		</div>
	</header>

	<nav class="flex gap-1 border-b border-zinc-800" aria-label="Weather views">
		{#each tabs as tab (tab.route)}
			<a
				href={tab.href}
				class={[
					'-mb-px border-b-2 px-4 py-2 text-sm',
					page.route.id === tab.route
						? 'border-sky-400 text-white'
						: 'border-transparent text-zinc-400 hover:text-white'
				]}
				aria-current={page.route.id === tab.route ? 'page' : undefined}
			>
				{tab.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
