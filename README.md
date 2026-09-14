# Testcontainers: The Game

A browser game with four levels about the things that break test suites:

1. **Wait strategies** — match the test's contract to a port, HTTP, SQL, exec,
   healthcheck, or composite check. See [the scenarios and sources](docs/wait-strategies.md).
2. **The flaky detective** — identify causes from CI run patterns.
3. **Pipe Dream** — connect the host to a container through a published port.
4. **Ryuk** — clean up your session's resources without disturbing other builds.

The game uses canvas and plain JavaScript modules. Progress and sound preferences
stay in browser localStorage under `testcontainers-game:v1`, preserving saves
from the original HTML game on the same origin.

## Local development

Use Node.js 24 (`nvm use` if you have nvm), then:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Serve the app over HTTP; do not open
`index.html` directly with a `file://` URL.

## Tests and builds

```sh
npm run tests          # Unit tests; npm test also works
npm run test:coverage  # Unit tests with Node's coverage report
npm run build          # Production HTML, JS, and CSS in dist/
npm run preview        # Serve the production build locally
```

Unit tests use Node's built-in test runner. They cover deterministic randomness,
wait-strategy verdicts and scoring, solvable flaky-test boards, pipe routing and
flow, Ryuk resource placement and cleanup, progression, and storage failures.
Generated boards are checked over repeatable seeds.

Browser tests use Playwright against the production build in desktop Chromium
and a mobile Chromium viewport. They check all four scenes, asset loading, menus,
pause/resume, and saved progress and sound settings. Install Chromium once:

```sh
npx playwright install chromium
npm run check          # Unit tests, build, then browser tests
```

On Linux, use `npx playwright install --with-deps chromium` to install the browser's
system dependencies too. To run only browser tests after a build, use
`npm run test:e2e`. Failure traces are saved under `test-results/`.

## GitHub Actions and Vercel

`.github/workflows/ci.yml` runs unit tests with coverage, builds the app, and runs
desktop and mobile browser tests on pushes and pull requests. It also supports a
manual run. The check is named **Test and build**.

Deployment uses Vercel's Git integration. No Vercel token or GitHub deployment
secrets are required. Connect the project yourself:

1. Import `mdelapenya/testcontainers-game` into Vercel with project name
   `testcontainers-game`, repository root `./`, and production branch `main`.
2. Use the **Vite** framework preset and Node.js **24.x**. `vercel.json` specifies
   `npm ci`, build command `npm run build`, and output `dist`.
   Remove conflicting dashboard overrides if you created the project from the
   original standalone HTML commit.
3. Assign or confirm **testcontainers-game.vercel.app** in the project's domains.
4. After the first GitHub workflow finishes, open Vercel **Settings → Deployment
   Checks → Add Checks**, choose **GitHub**, and require **Test and build**. Keep
   automatic aliasing enabled in the production environment settings.

Pushes to `main` create production deployments; other branches and pull requests
can create previews through the Git integration. Tests run in GitHub Actions;
Vercel only builds the app. Requiring the GitHub check prevents production
promotion until the unit tests, browser tests, and production build pass. Until
step 4 is configured, Vercel deployments and GitHub CI run independently, so
test failures do not block promotion.

See [Vercel's GitHub integration](https://vercel.com/docs/git/vercel-for-github)
and [Deployment Checks](https://vercel.com/docs/deployment-checks).

## Source layout

- `index.html` — page markup and external asset entry points.
- `styles/game.css` — shared styles and responsive layouts.
- `styles/fonts.css`, `public/fonts/` — locally served Rubik and Roboto Mono.
- `public/brand/`, `public/favicon.svg` — official Testcontainers cube and favicon.
- `src/main.js` — application startup, menus, and controls.
- `src/rules.js`, `src/rng.js`, `src/store.js` — game rules and persistence.
- `src/engine.js`, `src/draw.js`, `src/audio.js` — rendering loop, artwork, and sound.
- `src/levels/` — the four level scenes.
- `tests/` — unit tests and browser checks.

This is a fan game about [Testcontainers](https://testcontainers.com).
Asset sources, palette mappings, and license attribution are documented in
[docs/branding.md](docs/branding.md).
