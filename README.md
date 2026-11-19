# Dandelion Field

A living web art piece: visitors blow into their microphone or onto a paper pinwheel, and their breath scatters a dandelion seed in an abstracted map of IP space.

- [Architecture plan](Dandelion%20Field%20Architecture%20Plan.md)
- [Build plan](BUILD_PLAN.md)

## Phase 0 spikes

Throwaway prototypes in `spikes/`, published to GitHub Pages: https://mirzu.github.io/Fields/

- `breath.html`: mic → loudness, brightness, breathiness, breath detection, fingerprint
- `field.html`: fake meadow of network neighbourhoods, meadow vs Hilbert layout, seed visuals, wind, fading, watering
- `pinwheel.html`: webcam → coloured-mark tracking → spin speed and direction

Run locally:

```bash
python3 -m http.server 5173 --directory spikes
```
