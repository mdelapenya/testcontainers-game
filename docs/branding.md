# Testcontainers visual assets

The game's cube, favicon, fonts, and base palette come from
[testcontainers/testcontainers-site](https://github.com/testcontainers/testcontainers-site)
at commit `ef54353aab5ce9e3eaa29097fdf2e4014fae113b`.
The game retains its fan-game attribution in the footer.

Assets are served locally; there are no external font or image requests.
SVG and WOFF2 files are copied without modification:

| Upstream path | Local path |
| --- | --- |
| `assets/images/testcontainers-mark.svg` | `public/brand/testcontainers-mark.svg` |
| `static/favicon.svg` | `public/favicon.svg` |
| `static/fonts/rubik-v21-latin-regular.woff2` | `public/fonts/rubik-regular.woff2` |
| `static/fonts/rubik-v21-latin-500.woff2` | `public/fonts/rubik-medium.woff2` |
| `static/fonts/rubik-v21-latin-700.woff2` | `public/fonts/rubik-bold.woff2` |
| `static/fonts/roboto-mono-v22-latin-500.woff2` | `public/fonts/roboto-mono-medium.woff2` |

`styles/fonts.css` registers Rubik at weights 400, 500, and 700 and Roboto Mono
at weight 500, matching the source site's font definitions. Canvas font stacks
in `src/draw.js` use the same families, with system fallbacks while fonts load.

## Colors

Colors are taken from
[`assets/sass/_variables.scss`](https://github.com/testcontainers/testcontainers-site/blob/ef54353aab5ce9e3eaa29097fdf2e4014fae113b/assets/sass/_variables.scss).

| Site token | Hex | Game use |
| --- | --- | --- |
| Aqua | `#16D6C7` | Highlights, selections, cube, and hover states |
| Topaz | `#00BAC2` | Available CSS brand token |
| Pacific | `#17A6B2` | Sea and cube |
| Teal | `#027F9E` | Sea shading and cube |
| Eggplant | `#291A3F` | Canvas ink and available CSS brand token |
| Plum | `#361E5B` | Cube outline and illustration shading |
| Violet | `#6638F2` | Primary buttons and purple game pieces |
| Ghost | `#F7F9FD` | Main text |
| Mist | `#E7EAFB` | Supporting text |
| Fog | `#C3C7E6` | Secondary text and canvas accents |
| TC Blue 100 / 200 | `#EDF7FF` / `#D1EBFF` | Sky |

The interface tokens live in `styles/game.css`; canvas equivalents live in
`src/draw.js`. Keep their shared colors in sync when changing the theme.
The green, red, amber, and orange gameplay colors are retained from the game
to distinguish success, failure, warnings, and services. These are game-specific
colors, not additional Testcontainers brand colors. Page and canvas panel
backgrounds use the game's navy `#081A2E` and `#0E2A47`, with a `#14375C`
page glow, to keep violet concentrated in buttons and small accents.

## Attribution

- The source site's MIT license is included in
  `public/brand/LICENSE-testcontainers-site.txt`.
- Rubik's SIL Open Font License is included in `public/fonts/LICENSE-rubik.txt`,
  from [Google Fonts](https://github.com/google/fonts/blob/main/ofl/rubik/OFL.txt).
- Roboto Mono's SIL Open Font License is included in
  `public/fonts/LICENSE-robotomono.txt`, from
  [Google Fonts](https://github.com/google/fonts/blob/main/ofl/robotomono/OFL.txt).
