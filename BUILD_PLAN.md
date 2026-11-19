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
| Rendering | Canvas 2D to start, move to WebGL (raw or regl) once fiber counts need it | Canvas is quicker to iterate on the look; WebGL later for very dense heads |
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
6. **Visit de-duplication.** Fibers accumulate forever, so reload spam would grow a patch without limit. Count one visit per device per day using the daily-salted device hash, plus the per-prefix rate limit.
7. **Growing patches.** Fibers only grow, so patch and clump sizes change over time. The deep pass must reflow the layout without making the field jump for returning visitors.

---

## Phases

### Phase 0 — Spikes (answer the risky questions)
Small throwaway prototypes, one page each.

- **Breath spike.** Mic → RMS envelope, spectral centroid, spectral flatness. Show live numbers and a pass/fail "that was a breath" detector. Test on a laptop mic, phone, and headset.
- **Pinwheel spike.** Webcam → track a coloured mark → spin speed and direction. Find out how fast a hand-made pinwheel actually spins and whether 30 fps is enough. This is the riskiest part of the project.
- **Field spike (layout + look), done.** Fake meadow of ~2,000 patches. First version: breath seeds, blooms and fading; it led to the concept change. Current version: visits grow fibers, breaths are gusts that comb fibers and relax, pinwheel strokes bend with the comb. Meadow layout chosen over Hilbert (tentatively). Your visit lands in your real /16: the page asks Cloudflare's `1.1.1.1/cdn-cgi/trace` (falling back to ipify) for its IP and keeps only the first two numbers. In production the ingest Worker reads the IP itself, so no third-party lookup is needed.

*Done when:* each open question in the architecture doc has a decision written down.

### Phase 1 — Core package
`packages/core`, fully unit tested, no browser or Worker dependencies.

- Record encode/decode (versioned binary, ~20 bytes)
- Gust character from a sample buffer (envelope resample, centroid, flatness, duration, peak)
- Wind: local time → direction (sea-breeze curve) + pinwheel swirl; time → colour
- Comb: lean at a point from a set of gusts (falloff, half-life, envelope playback)
- Fibers: deterministic fiber positions from a patch's visit history
- Layout: prefix → position in the field, clump hierarchy per zoom level
- Scatter: keyed hash of the IP remainder → offset inside a patch
- Zone file and summary file formats

### Phase 2 — Local-only field (no server)
`apps/web` running against generated data.

- Capture UI for breath mode with mic permission flow and a clear "audio never leaves your device" note
- Your visit grows fibers instantly where a fake IP would place you; your breath combs them
- Renderer: pan/zoom, summary at low zoom, fibers at high zoom, gust playback and relaxing lean
- Fake data generator that produces realistic zone and summary files on disk

*Done when:* you can blow into the mic and watch your breath comb your patch of a convincing fake meadow.

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

### Phase 5 — Growth and relaxing
- Visits folded into per-patch visit history; one visit per device per day
- Nightly deep pass: reflow grown patches, delete relaxed gusts and faded strokes, delete processed log chunks, discard old keys
- Per-clump summaries (fiber count, colour, recency, lean, pinwheel activity) for every zoom level

### Phase 6 — Pinwheel mode
- Build the real tracker from the Phase 0 spike, with mic assist when the mark blurs
- Pinwheel strokes, bent by local breath
- Printable template PDF with tracking mark, plus hand-drawn instructions

### Phase 7 — Live relay and bees (optional)
- Durable Object relay broadcasting new gusts instantly, so neighbours' breaths play live
- Bees: live visitors' positions about once a second, storing nothing

### Phase 8 — Launch readiness
- Privacy notice; GDPR/CCPA review
- Mobile browser testing (iOS Safari mic and camera permission quirks)
- Accessibility: a way to take part without a mic or camera (e.g. press-and-hold), and reduced-motion mode
- Load test ingest and compaction with synthetic traffic

---

## Where things stand

Phase 0 is mostly done. Remaining: fix breath-vs-voice detection (flatness alone failed on iPhone), try the pinwheel spike with a real pinwheel, and decide the open questions in the architecture doc (comb half-life, fibers per visit, reflow cadence).
