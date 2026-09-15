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
npm run extract
npm run validate
```

## Data boundaries

- `raw-cache/`: exact downloaded HTML plus hashes in the manifest.
- `documentary-json/`: literal source sections, tables and links.
- `reports/`: deterministic validation results.
- No Compass scores, rule summaries, inferred requirements or application data are generated.

Before a full run, test structurally different classes and inspect the resulting sections. AoN uses several legacy HTML layouts, so a passing download does not by itself prove documentary completeness.

## Reusing the engine

The downloader and documentary extractor are entity-agnostic. `config.json` contains collection profiles for feats and traits. A profile only needs index URLs, a detail-page path and the query parameter that carries the canonical name. Spells or other AoN catalogues can be added with the same small configuration when their index layout is confirmed.
