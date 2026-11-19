# Dandelion Field: Architecture Plan

A living web art piece. Visitors blow into their microphone or onto a paper pinwheel, and their breath scatters a dandelion seed placed in an abstracted map of IP space. Everyone online at the same time of day blows in the same direction. Old breaths fade.

## Concept

- Each breath becomes a seed positioned by the visitor's network neighbourhood, never their exact address.
- Shared IPs (offices, VPNs) appear as an anonymous crowd: many seeds clustered in one patch.
- Wind direction comes from the visitor's local time of day and is frozen into the seed when the breath is recorded, so everyone at 4:00 local blows the same way.
- Pinwheel spin direction adds a small personal swirl on top of the shared wind.
- Two input modes, both first-class: breath via microphone and a physical paper pinwheel via camera. Each gets a slightly different visual representation in the same field.
- The past never disappears: old breaths grow diffuse and sink into a shared colour palette. Returning visitors renew their breath.

## Design Constraints

- Run as much as possible in the browser.
- Minimal hosting and database cost. Data lives in static files, served in zones.
- Store only what is needed: network position, rounded time, breath character, hashed device fingerprint.
- No raw IPs or audio ever published.

## Components

### 1. Capture (browser)

**Breath mode.** getUserMedia opens the mic with noise suppression and echo cancellation turned off. An AudioContext feeds an AnalyserNode, sampled about 60 times per second for waveform (RMS loudness) and frequency spectrum. All audio stays on the device.

**Pinwheel mode.** The webcam tracks a bold mark on one blade frame to frame to compute spin speed and direction. Frame rate (about 30 fps) limits reliable speed to roughly 15 turns per second, so the template favours slower, stiffer blades. The mic can assist when the pinwheel blurs.

**Breath fingerprint (about 20 bytes).**

- Envelope: loudness curve resampled to 16 points, 4 to 8 bits each
- Brightness: spectral centroid, 1 byte
- Breathiness: spectral flatness, 1 byte (also validates it was a breath)
- Duration: 1 byte
- Peak strength: 1 byte
- Mode flag: breath or pinwheel, plus spin direction

**Device fingerprint.** A salted hash, used only to tell apart devices sharing one IP.

### 2. Ingest (edge function)

A small serverless function, for example a Cloudflare Worker.

- Reads the visitor IP.
- Keeps the prefix (first two or three octets) to choose the neighbourhood.
- Hashes the remainder with a secret, rotating key to scatter the seed inside its patch.
- Rounds the timestamp to a few minutes.
- Discards the raw IP and appends the record to the log.

### 3. Storage

Cheap object storage, for example Cloudflare R2, holding the append log in short time chunks.

### 4. Compaction (scheduled job)

Runs every few minutes.

- Rolls the log up into zone files keyed by IP prefix.
- Melts aged seeds into a per-patch colour layer, keeping storage bounded.
- Builds a low-detail summary for the zoomed-out view.
- Rotates and discards the secret key, so old seeds can never be linked back.

### 5. Static Delivery

Zone files and the summary are served from a CDN. Reads cost almost nothing.

### 6. Renderer (browser)

Canvas or WebGL.

- Lays out IP prefixes spatially (Hilbert curve or meadow layout) so nearby networks stay near each other.
- Loads the summary first, then detailed zones on zoom, like map tiles.
- Computes the shared wind from time of day.
- Replays each seed's envelope as its gust. Brightness drives colour or fluffiness; breathiness drives wobble.
- Renders breaths as radiating pulses of colour and pinwheels as directional strokes.
- Diffuses seeds into the ground colour as they age.

### 7. Pinwheel Template

A printable PDF with a built-in tracking mark, plus instructions for making one by hand with a marker if there is no printer.

## Privacy

- Full IPs are processed only at ingest and never stored or published.
- Published positions reveal only the network prefix; the scatter is keyed and one-way.
- Times are rounded.
- Fingerprint hashes use a salt rotated daily and discarded.
- Individual records are merged into anonymous patch colour as they age.
- A short privacy notice explains what is collected, why, and when it is deleted, and that audio never leaves the device.
- Worth a review by someone versed in GDPR and CCPA before launch.

## Fading and Renewal

Nothing is ever lost; breaths slowly turn from marks into colour.

- **Two layers.** Fresh seeds sit on top as individual marks. Aged seeds are melted by compaction into a ground colour layer per IP patch.
- **Diffusion.** Over time a seed loses its edges and its hue blends into its patch, so the field becomes an accumulating painting.
- **Breath vs pinwheel.** Breaths leave radiating pulses of colour, like watercolour blooms. Pinwheels leave gusts with a distinct vector, like brushstrokes. Together they form fields of colour and shape.
- **Renewal.** The browser keeps its own random token in local storage and sends it with each breath. A return from the same device and network revives that seed.
- **Privacy fit.** The server never holds a lasting ID. Clearing the browser simply lets the old breath settle into the colour.

## Visitor Layer

Simply visiting is a quiet form of participation: visitors bring the water that makes the colour bloom.

### Version 1: Watering

- Each visit waters the visitor's own clump and the areas they zoom into.
- Watered areas become rich and saturated; neglected corners dry out and go pale.
- Watching a place keeps it vivid, a gentle feedback loop.
- Stored only as a visit count per clump that slowly evaporates. No individual records.

### Version 2: Bees

- Each live visitor appears as a bee drifting around their neighbourhood and the seed heads they explore. It flies off when they leave.
- Live visitors can lightly see and interact with each other.
- Transport: a small real-time relay (for example a Cloudflare Durable Object) passing bee positions about once per second, storing nothing.
- Not peer-to-peer WebRTC: direct connections expose visitors' IPs to each other and scale poorly beyond a handful of people.

## Activity at Every Scale

Visitors land in their own neighbourhood and zoom out through ever-larger clumps; each layer owns one visual channel so activity reads at a glance at any scale.

- **Breaths → fullness.** Many breaths make a big, fluffy seed head; few make a sparse head or a bud.
- **Pinwheels → motion.** Pinwheel-heavy regions sway and stream visible strokes in the wind.
- **Visitors → saturation.** Watered regions run deep and vivid; ignored ones fade pale.
- **Old breaths → ground colour.** Accumulated, diffused breaths sit underneath as memory.
- **Data.** Compaction stores a few summary numbers per clump per zoom level: breath count, pinwheel energy, visit saturation, average colour.
- **Layout direction.** Leaning toward a meadow of nested seed heads (possibly golden-angle phyllotaxis) over a visible Hilbert grid.

## Wind

Each seed carries the wind of its own moment for its whole existence.

- **Local time.** The browser reports its time zone; each breath records its rounded local time.
- **Frozen.** Direction is set once at the breath and never changes live.
- **Sea-breeze mapping.** Time of day maps to a back-and-forth axis rather than a full rotation: midday breaths and midnight breaths point in opposite directions, with dawn and dusk as the turning points.
- **Result.** The meadow becomes a map of habits: afternoon office clumps stream one way, night owls the other, mixed neighbourhoods form crosscurrents. VPN clumps swirl with many time zones at once.

## Compaction and Freshness

Your own breath appears instantly; everyone else's arrive within about a minute.

- **Instant self.** The browser draws your seed the moment you blow and sends it in the background. No waiting on the server.
- **Quick pass (target every minute).** Reads new breaths and visits, updates only the touched zone files, revives seeds whose token matches, and refreshes summaries up the clump chain.
- **Deep pass (nightly).** Ages seeds into ground colour, evaporates watering, deletes processed log chunks, rotates and discards secret keys.
- **Optional live mode.** The bee relay can broadcast new breaths to everyone instantly; compaction then just makes them permanent.

| Cost item | Rough figure (unverified) |
| --- | --- |
| Workers paid plan | about $5/month, covers about 43,000 cron runs/month at once per minute |
| R2 writes | about $4.50 per million; 50 zone files per minute is about $10/month |
| R2 reads and egress | cheap reads, no bandwidth fees |

Cost scales with the number of zones that change, not with visitor count.

## Open Questions

- Hilbert curve or meadow layout for IP space
- How long a seed stays distinct before it diffuses
- Verify current Cloudflare pricing; pick quick-pass interval (target: every minute)
- Exact visual difference between breath seeds and pinwheel seeds
- Exact curve of the sea-breeze mapping (calm points at dawn and dusk?)
