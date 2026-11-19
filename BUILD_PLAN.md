# Dandelion Field: Build Plan

Companion to `Dandelion Field Architecture Plan.md`. That document says *what* the piece is; this one says *in what order* to build it and *with what*.

Guiding idea: build the field so it works entirely in the browser first, with fake data, then add the server one piece at a time. Each phase ends with something you can look at.

---

## Proposed stack

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | One record format and one wind/layout module shared by browser, Worker and compactor |
| Repo layout | One repo, npm workspaces | `packages/core`, `apps/web`, `workers/ingest`, `workers/compact` |
| Web build | Vite | Fast dev server, static output for the CDN |
| Rendering | Canvas 2D to start, move to WebGL (raw or regl) once seed counts need it | Canvas is quicker to iterate on the look; WebGL later for thousands of animated seeds |
| Audio | Web Audio API (`AnalyserNode`) | Native, no library |
| Pinwheel tracking | Plain `getUserMedia` + canvas pixel reads, colour-blob tracking | A bold coloured mark is enough; avoids shipping OpenCV |
| Edge / ingest | Cloudflare Worker | As in the architecture doc |
| Write buffer | Cloudflare Queue (or a Durable Object) | See gap 1 below |
| Storage | Cloudflare R2 | Zone files, summaries, log chunks |
| Compaction | Worker on a Cron Trigger (every minute) | Same codebase as ingest |
| Hosting | Cloudflare Pages for the site, R2 behind the CDN for data | One provider, one bill |
| Tests | Vitest | Core module (record encoding, wind, layout, hashing) needs real unit tests |

---

## Gaps in the architecture doc to settle early

These aren't in the open-questions list but will shape the code:

1. **R2 has no append.** "Append the record to the log" means one object write per breath unless the Worker buffers. Route breaths through a Cloudflare Queue (or a single Durable Object) that batches them into one log chunk per few seconds. This also keeps R2 write costs tied to time, not traffic.
2. **IPv6.** Roughly half of traffic. Need a prefix rule (e.g. keep the first /32 or /40) and a decision on where v6 sits in the layout relative to v4.
3. **Prefix width and privacy.** Keeping three IPv4 octets (/24) can single out a home connection on a small ISP. Suggest /16 for the published position and use the hashed remainder only for scatter. Also expect mobile carrier NAT (CGNAT) to create huge crowds in a few patches.
4. **Abuse.** Anyone can POST fake breaths. Need per-prefix rate limiting at ingest (Cloudflare's rate limiting or a counter in the Durable Object) and a sanity check on the fingerprint values. Client-side "was it really a breath" checks can be forged, so they are a filter, not a guarantee.
5. **Binary record format.** Fix the ~20-byte layout in one place (`packages/core`) with a version byte, so old log chunks stay readable when the format changes.
6. **Renewal window.** Reviving a seed by token only works while the key that scattered it still exists. Decide whether renewal works within a day (key lifetime) or keep a separate, longer-lived token→seed map, which weakens the "no lasting ID" promise.

---

## Phases

### Phase 0 — Spikes (answer the risky questions)
Small throwaway prototypes, one page each.

- **Breath spike.** Mic → RMS envelope, spectral centroid, spectral flatness. Show live numbers and a pass/fail "that was a breath" detector. Test on a laptop mic, phone, and headset.
- **Pinwheel spike.** Webcam → track a coloured mark → spin speed and direction. Find out how fast a hand-made pinwheel actually spins and whether 30 fps is enough. This is the riskiest part of the project.
- **Layout spike.** Plot a few thousand fake prefixes with a Hilbert curve and with a golden-angle phyllotaxis meadow side by side. Settles the layout open question.
- **Look spike.** One seed head drawn on canvas: breath bloom vs pinwheel stroke, and a seed fading into ground colour. Settles the visual open questions.

*Done when:* each open question in the architecture doc has a decision written down.

### Phase 1 — Core package
`packages/core`, fully unit tested, no browser or Worker dependencies.

- Record encode/decode (versioned binary, ~20 bytes)
- Breath fingerprint from a sample buffer (envelope resample, centroid, flatness, duration, peak)
- Wind: local time → direction (sea-breeze curve) + pinwheel swirl
- Layout: prefix → position in the field, clump hierarchy per zoom level
- Scatter: keyed hash of the IP remainder → offset inside a patch
- Zone file and summary file formats

### Phase 2 — Local-only field (no server)
`apps/web` running against generated data.

- Capture UI for breath mode with mic permission flow and a clear "audio never leaves your device" note
- Your seed appears instantly where a fake IP would place you
- Renderer: pan/zoom, summary at low zoom, detail at high zoom, wind replay from each seed's envelope
- Fake data generator that produces realistic zone and summary files on disk

*Done when:* you can blow into the mic and watch your seed join a convincing fake meadow.

### Phase 3 — Ingest and storage
- Ingest Worker: read IP, take prefix, scatter with the current key, round time, drop the raw IP, push to the Queue
- Queue consumer writes batched log chunks to R2
- Daily key and salt rotation (keys held in KV or Durable Object storage, deleted after use)
- Rate limiting per prefix
- Local development with `wrangler dev` and a local R2 bucket

### Phase 4 — Quick compaction pass and delivery
- Cron Worker every minute: read new log chunks, update only touched zone files, rebuild summaries up the clump chain
- Serve zone files and summaries from R2 through the CDN with short cache times
- Renderer switches from fake files to real ones
- Measure actual R2 operations per minute against the cost table

*Done when:* a breath from one browser shows up in another within about a minute.

### Phase 5 — Fading and renewal
- Nightly deep pass: melt aged seeds into per-patch ground colour, delete processed log chunks, discard old keys
- Local-storage token sent with each breath; quick pass revives matching seeds
- Renderer draws the two layers (fresh marks over ground colour) and the diffusion over time

### Phase 6 — Pinwheel mode
- Build the real tracker from the Phase 0 spike, with mic assist when the mark blurs
- Pinwheel seeds drawn as directional strokes
- Printable template PDF with tracking mark, plus hand-drawn instructions

### Phase 7 — Watering (Visitor Layer v1)
- Visits and zoomed-into areas counted per clump at ingest (no individual records)
- Evaporation in the deep pass; saturation channel in the renderer

### Phase 8 — Bees (Visitor Layer v2, optional)
- Durable Object relay passing positions about once a second, storing nothing
- Optional live broadcast of new breaths

### Phase 9 — Launch readiness
- Privacy notice; GDPR/CCPA review
- Mobile browser testing (iOS Safari mic and camera permission quirks)
- Accessibility: a way to take part without a mic or camera (e.g. press-and-hold), and reduced-motion mode
- Load test ingest and compaction with synthetic traffic

---

## Suggested first step

Start Phase 0 with the **breath spike** and **pinwheel spike** in parallel. They decide whether the input side of the piece works at all, and they need no backend.
