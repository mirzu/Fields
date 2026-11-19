# Dandelion Field

A living web art piece: every visit grows fibers in the visitor's patch of an abstracted map of IP space, and breath (into a microphone or onto a paper pinwheel) combs the fibers around them.

- [Architecture plan](Dandelion%20Field%20Architecture%20Plan.md)
- [Build plan](BUILD_PLAN.md)

## Phase 0 spikes

Throwaway prototypes in `spikes/`, published to GitHub Pages: https://mirzu.github.io/Fields/

- `breath.html`: mic → loudness, brightness, breathiness, breath detection, fingerprint
- `field.html`: fake meadow of network neighbourhoods; visits grow fibers, breaths comb them and relax, pinwheel strokes bend with the comb
- `pinwheel.html`: webcam → coloured-mark tracking → spin speed and direction

Run locally:

```bash
python3 -m http.server 5173 --directory spikes
```
