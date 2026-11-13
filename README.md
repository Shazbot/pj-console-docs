# pj_console docs

Static GitHub Pages site documenting the `pj_console` command console mod for Total War: Warhammer 3. No build step and no dependencies; the page is `index.html` plus `assets/`, `data/commands.json` and `keys/*.json`.

## Layout

- `data/commands.json`: command reference, hand-maintained. `node tools/check-commands.mjs [--lua <file>]` compares it with the patterns in `pj_console.lua` (read from `pj_console.pack` by default via the WHMM CLI) and fails on missing or stale patterns.
- `keys/`: database keys with display names, generated from a local WH3-Dump clone. Do not edit by hand.
- `assets/complete.js`: completion logic (pure, tested). `assets/app.js`: DOM wiring.

## Rebuild keys

```
node tools/build-keys.mjs [--dump K:/projects/wh3dump]
```

Reads the working tree of the dump (also the `WH3DUMP` env var) and never modifies it. It warns if the dump HEAD is not pushed or has uncommitted changes under `db/` or `text/db/`.

## Test and preview

```
npm test
npm run serve    # http://localhost:4173/
```

## Deploy

```
node tools/deploy.mjs [--no-push] [--dump <path>]
```

Rebuilds keys, runs the check and tests, commits `keys: WH3-Dump <sha>` if anything changed, then pushes.

## Enable GitHub Pages

Repository Settings, Pages, Build and deployment: Deploy from a branch, branch `main`, folder `/ (root)`. All URLs are relative, so the site works under `/<repo>/`.
