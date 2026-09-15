# Archives of Nethys documentary scraper

This tool downloads and preserves Pathfinder 1e class and archetype source pages. It deliberately does not interpret game rules or write to the production application.

## What is committed to Git

- Scraper and validator source code.
- Configuration and Windows launcher.
- Small synthetic test fixtures.

The `work/` directory is ignored. Raw HTML, checkpoints, generated JSON and reports remain local because they are reproducible and can be large.

## Windows use

1. Double-click `RUN_SCRAPER.bat`.
2. Choose `1` for the Fighter pilot or `2` for the approved four-class diversity test.
3. Review `work/reports/validation.json`.
4. Choose the full-run option only after both pilots have been reviewed.

The downloader saves every page and updates its checkpoint immediately. Re-running it skips valid cached pages and retries prior failures.

To avoid downloading records already covered locally, copy `examples/existing-coverage.json` to `input/existing-coverage.json` and list only entity IDs or URLs whose **full documentary mechanics** already exist. Spell-only coverage must not be placed on the skip list.

## Command-line use

```text
npm install
npm run pilot
node src/cli.js scrape --class Cleric
node src/cli.js scrape-collection --profile feats
node src/cli.js coverage --profile feats --appFile ../pathfinder-tools/calc/index.html
node src/cli.js coverage --profile traits --appFile ../pathfinder-tools/calc/index.html
npm run extract
npm run validate
```

## Checking feat/trait coverage against the app

`coverage --profile feats|traits [--appFile <path>]` answers "does the app
have every AoN feat/trait name accounted for" cheaply -- it downloads only
the collection's index page(s) (one request for feats; traits are listed per
category on AoN, one request per category, see `config.json`), never the
thousands of individual detail pages. Results are written to
`work/coverage/<profile>-canonical.json` (every AoN name found) and, when
`--appFile` is given, `work/coverage/<profile>-diff.json` (`missing`: AoN has
it, the app file doesn't; `extra`: the app file has a name AoN's current
listing doesn't recognise -- usually a rename/errata or a typo, worth a human
look, not necessarily wrong).

`--appFile` must point at a source file where each entry looks like
`name:'X',category:'feat'` (or `'trait'`) with those two fields adjacent --
this matches `pathfinder-tools/calc/index.html`'s own embedded `MODIFIERS`
array today. If that file's structure ever changes, `src/coverage.js`'s
extractor (and its own doc comment) needs re-checking, not just the config.

## Data boundaries

- `raw-cache/`: exact downloaded HTML plus hashes in the manifest.
- `documentary-json/`: literal source sections, tables and links.
- `reports/`: deterministic validation results.
- No Compass scores, rule summaries, inferred requirements or application data are generated.

Before a full run, test structurally different classes and inspect the resulting sections. AoN uses several legacy HTML layouts, so a passing download does not by itself prove documentary completeness.

## Reusing the engine

The downloader and documentary extractor are entity-agnostic. `config.json` contains collection profiles for feats and traits. A profile only needs index URLs, a detail-page path and the query parameter that carries the canonical name. Spells or other AoN catalogues can be added with the same small configuration when their index layout is confirmed.
