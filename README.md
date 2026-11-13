# ADS-B receiver

Live Mode S / ADS-B traffic from an RTL-SDR on a Raspberry Pi ([pi/README.md](pi/README.md)),
decoded and shown by this SvelteKit app.

## Configuration

Copy `.env.example` to `.env`. Everything is optional:

| Variable          | Default | What it is                                                |
| ----------------- | ------- | --------------------------------------------------------- |
| `RECEIVER_HOST`   | `pi`    | Host running readsb with Beast output                     |
| `RECEIVER_PORT`   | `30005` | readsb Beast output port                                  |
| `REFERENCE_POINT` | –       | A point near the receiver, `"latitude,longitude"` (below) |

### Reference point

`REFERENCE_POINT` lets /raw decode a position from a single ADS-B message (local CPR
decoding). Without it, positions are only decoded from even/odd message pairs.

**It doesn't have to be exact, and shouldn't be.** It only picks which CPR zone the
aircraft is in, so it just has to be within about 150 NM of airborne aircraft (45 NM for
aircraft on the ground). Round it to one decimal (≤ 6 km off): /raw shows it in its
status bar. The only visible effect of rounding is on the distances and directions in the
feed ("67 km SW"), which are measured from the reference point, not from the antenna.

## Svelte project (sv)

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

### Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
bun x sv@1.3.0 create --template minimal --types ts --add tailwindcss="plugins:none" vitest="usages:unit,component" prettier eslint ai-tools="ide:claude-code+delivery:plugin+optInSkills:svelte-mcp-feedback" --install bun adb-s-display
```

### Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

### Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
