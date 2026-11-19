# Dandelion Field: Architecture Plan

A living web art piece. Every visit grows fibers in the visitor's patch of an abstracted map of IP space. Visitors blow into their microphone or onto a paper pinwheel, and their breath combs the fibers around them. Everyone online at the same time of day blows in the same direction. The comb slowly relaxes; the fibers stay forever.

## Concept

- **Visits grow fibers.** Each visit adds a few fibers to the visitor's network neighbourhood (a /16 patch), never their exact address. Fibers never disappear, so busy neighbourhoods grow into dense heads and the field keeps every visit it has ever had.
- **Breath moves fibers.** A breath does not add anything of its own. It is a gust that combs the fibers along its wind: strongest in the breather's own patch, weaker in nearby patches of the same clump, nothing beyond. The gust plays out live, then the lean slowly relaxes back.
- **Breaths are shared.** Every gust is stored and replayed, so visitors watch their neighbours' breaths move the fibers.
- **Pinwheels leave strokes.** A pinwheel places a curled, streaming stroke along its wind, curled by spin direction. Strokes are also bent by local breath. They stay distinct for a few days, then fade.
- **Shared IPs** (offices, VPNs, carrier NAT) appear as one crowded patch.
- **Wind** comes from the visitor's local time of day and is frozen into each gust or stroke when it is recorded, so everyone at 4:00 local blows the same way.
- **Colour** also comes from time of day: daytime visits are amber, dawn and dusk rose, night blue. Recent visits are brighter; old fibers dim but remain.
- Two input modes, both first-class: breath via microphone and a physical paper pinwheel via camera.

## Design Constraints

- Run as much as possible in the browser.
- Minimal hosting and database cost. Data lives in static files, served in zones.
- Store only what is needed: network position, rounded time, gust character, a daily-salted device hash for de-duplicating visits.
- No raw IPs or audio ever published.

## Components

### 1. Capture (browser)

**Breath mode.** getUserMedia opens the mic with noise suppression and echo cancellation turned off. An AudioContext feeds an AnalyserNode, sampled about 60 times per second for waveform (RMS loudness) and frequency spectrum. All audio stays on the device.

**Pinwheel mode.** The webcam tracks a bold mark on one blade frame to frame to compute spin speed and direction. Frame rate (about 30 fps) limits reliable speed to roughly 15 turns per second, so the template favours slower, stiffer blades. The mic can assist when the pinwheel blurs.

**Gust character (about 20 bytes).** Describes how a breath moves fibers.

- Envelope: loudness curve resampled to 16 points, 4 to 8 bits each. Replayed as the gust's push over time.
- Brightness: spectral centroid, 1 byte. Bright breaths are sharp and short-reaching; dark breaths broad and gentle.
- Breathiness: spectral flatness, 1 byte. Spreads the comb direction (turbulence) and drives wobble. Also part of validating that it was a breath.
- Duration: 1 byte
- Peak strength: 1 byte. Sets how hard and how far the gust pushes.
- Mode flag: breath or pinwheel, plus spin direction

**Device hash.** A daily-salted hash, used only to count one visit per device per day and to tell apart devices sharing one IP.

### 2. Ingest (edge function)

A small serverless function, for example a Cloudflare Worker. Two record types:

- **Visit:** patch, rounded local time.
- **Gust / stroke:** patch, scatter position inside the patch, rounded local time (fixes wind and colour), character bytes.

For both:

- Reads the visitor IP.
- Keeps the prefix (first two octets for IPv4; a rule is still needed for IPv6) to choose the patch.
- Hashes the remainder with a secret, rotating key to place a gust or stroke inside its patch.
- Rounds the timestamp to a few minutes.
- Discards the raw IP and appends the record to the log (batched; R2 has no append).

### 3. Storage

Cheap object storage, for example Cloudflare R2, holding the append log in short time chunks.

### 4. Compaction (scheduled job)

- **Visits:** folded into per-patch fiber records. Fiber positions are derived deterministically from visit order, so only a compact visit history per patch is stored (rounded time per visit, or per-day hour-of-day counts). This is the only part of storage that grows forever, and it grows with visits, not breaths.
- **Gusts:** kept as individual events in zone files while they still visibly comb the fibers. Once fully relaxed (after several half-lives) they are deleted.
- **Strokes:** kept while distinct, then dropped (optionally leaving a trace in the patch's ground colour).
- Builds per-clump summaries for each zoom level.
- Rotates and discards secret keys, so old gusts can never be linked back.

### 5. Static Delivery

Zone files and summaries are served from a CDN. Reads cost almost nothing.

### 6. Renderer (browser)

Canvas 2D (a WebGL renderer may be needed later for very dense heads).

- Lays out IP space as a meadow of nested seed heads: each /8 clump is a head, each /16 patch a floret inside it. Address order sets the angle, so neighbouring networks lean the same way; size follows activity. (A Hilbert grid was tried and kept tidier address order, but can't show crowds or growth.)
- Fibers grow out from each patch centre in a golden-angle spiral, oldest in the middle, newest at the edge.
- Loads the summary first, then detailed zones on zoom, like map tiles.
- For each fiber, sums the lean from every gust that reaches it: direction from the gust's frozen wind, weight falling off with distance from where the gust landed, decaying with a half-life. A gust that is still playing pushes along its envelope and makes fibers wobble.
- Draws pinwheel strokes on top, bent by the same lean.
- Zoomed out, each clump is one head: fullness shows visits, lean shows recent breath, streaks show pinwheels.

### 7. Pinwheel Template

A printable PDF with a built-in tracking mark, plus instructions for making one by hand with a marker if there is no printer.

## Privacy

- Full IPs are processed only at ingest and never stored or published.
- Published positions reveal only the network prefix. Fiber positions come from visit order, not from the address; gust and stroke positions use a keyed, one-way scatter.
- Times are rounded.
- Device hashes use a salt rotated daily and discarded.
- Gusts are deleted once they have relaxed; only per-patch visit history is kept long term.
- A short privacy notice explains what is collected, why, and when it is deleted, and that audio never leaves the device.
- Worth a review by someone versed in GDPR and CCPA before launch.

## Fibers, Combing and Relaxing

- **Fibers accumulate forever.** One visit per device per day adds a small, fixed number of fibers (currently 5 in the spike). Patches grow outward as rings; the layout reflows during compaction.
- **Combing.** A gust adds a lean to every fiber it reaches. Many breaths in one direction comb a patch smooth; breaths at different times of day leave crosscurrents.
- **Relaxing.** Each gust's effect halves every few hours (spike default: 12), so a neighbourhood's lean shows its recent breathing, and a quiet patch returns to an open starburst.
- **Live replay.** When a new gust arrives, its loudness curve plays out over a couple of seconds as a visible push and wobble, then it settles into the slowly relaxing lean.
- **Pinwheel strokes** stay distinct for a few days, then fade.

## Visitor Layer

Visiting is now the main source of material: fibers replace the earlier "watering" idea.

### Bees (optional)

- Each live visitor appears as a bee drifting around their neighbourhood and the heads they explore. It flies off when they leave.
- Transport: a small real-time relay (for example a Cloudflare Durable Object) passing bee positions about once per second, storing nothing. The same relay can broadcast new gusts instantly.
- Not peer-to-peer WebRTC: direct connections expose visitors' IPs to each other and scale poorly beyond a handful of people.

## Activity at Every Scale

Each layer owns one visual channel so activity reads at a glance at any scale.

- **Visits → fullness.** Many visits make a big, dense head; few make a sparse head or a bud.
- **Time of day of visits → colour.** Office clumps glow amber, night owls blue, mixed neighbourhoods rose.
- **Recent breath → lean.** Combed heads lean the way their recent wind blew; quiet heads stand open.
- **Pinwheels → streaming strokes.**
- **Data.** Compaction stores a few summary numbers per clump per zoom level: fiber count, colour, recency, current lean, pinwheel activity.

## Wind

Each gust and stroke carries the wind of its own moment for its whole existence.

- **Local time.** The browser reports its time zone; each record keeps its rounded local time.
- **Frozen.** Direction is set once at the breath and never changes live.
- **Sea-breeze mapping.** Time of day maps to a back-and-forth axis rather than a full rotation: midday and midnight breaths point in opposite directions, with dawn and dusk as calm turning points. A calm-hour breath still stirs fibers sideways in a small swirl.
- **Result.** The meadow becomes a map of habits: afternoon office clumps combed one way, night owls the other, mixed neighbourhoods tousled. VPN clumps swirl with many time zones at once.

## Compaction and Freshness

Your own visit and breath appear instantly; everyone else's arrive within about a minute.

- **Instant self.** The browser grows your fibers and plays your gust the moment you blow, and sends it in the background.
- **Quick pass (target every minute).** Reads new visits and gusts and updates only the touched zone files and summaries.
- **Deep pass (nightly).** Reflows grown patches, deletes relaxed gusts and faded strokes, deletes processed log chunks, rotates and discards secret keys.
- **Optional live mode.** The relay broadcasts new gusts to everyone instantly; compaction then just makes them permanent.

| Cost item | Rough figure (unverified) |
| --- | --- |
| Workers paid plan | about $5/month, covers about 43,000 cron runs/month at once per minute |
| R2 writes | about $4.50 per million; 50 zone files per minute is about $10/month |
| R2 reads and egress | cheap reads, no bandwidth fees |

Cost scales with the number of zones that change, not with visitor count.

## Open Questions

- Comb half-life (spike default 12 hours) and how far a strong breath reaches
- Fibers per visit, and whether very old fibers should thin visually so huge crowds stay legible
- How often to reflow the layout as patches grow
- How long pinwheel strokes stay, and whether they leave a trace in ground colour
- Breath detection: telling breath from voice reliably (flatness alone failed on iPhone; try band-wise flatness and a pitch test)
- Verify current Cloudflare pricing; pick quick-pass interval (target: every minute)
