# Bundled map

OpenFreeMap vector tiles for central Adelaide, including the demo neighbourhood,
at source zooms 0–14. Higher display zooms use the zoom 14 tiles.
`manifest.json` records the covered areas and a SHA-256 for every tile.

Source: https://tiles.openfreemap.org/planet

Attribution: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
· [© OpenMapTiles](https://openmaptiles.org/) · [OpenFreeMap](https://openfreemap.org/).

These files ship with the project so a fresh local setup works offline.
`npm run cache:map` checks and restores the demo area. To include another area,
run `npm run cache:map -- west south east north` while online, then include
the updated folder when sharing the project. Offline requests for missing
tiles return 404 immediately, without contacting an external service.
