# DayEnglish Game SDK 0.2

## Game-owned window controls

When `context.capabilities` includes `view.window.v1`, render your own expand/collapse
icon next to the game's controls. Start from `context.view?.expanded ?? false`.
Call `platform.request('view.set', { expanded: true })` to fill the browser window,
or `{ expanded: false }` to return to the embedded layout. Use the returned state
and `view.changed` events (`event.expanded`) to update the icon. Handle request errors
without changing the game session; hide this control on older hosts without the capability.

The host resizes the existing iframe, without reloading or recreating it. This is
full-window layout, not the browser Fullscreen API. Authentication, AI and save
dialogs remain available above the game. View changes must not resume a paused game:
handle `paused`, `resumed`, `closed` and `view.changed` separately. No API deployment
or backend permission is needed for window controls. Standalone games may use their
own browser fullscreen control instead.

An engine-independent browser SDK. Phaser and Three.js call it from JavaScript;
Godot can call the same API through JavaScriptBridge (no Godot adapter shipped).
The game owns its engine and content. DayEnglish owns login, dictionary, AI keys,
entitlements and storage. No React import, secret or direct database access is needed.

## Start a separate game project

From the DayEnglish checkout:

```powershell
npm run dev -- --port 5173
```

In another terminal:

```powershell
npm run games:demo
```

Open `http://localhost:5173/games/integration-demo`. The separate fixture runs on
`http://localhost:5188` and imports this actual SDK. It is a protocol test scene,
not the first game. The fixture is excluded from the application bundle/APK.
The developer catalogue entry exists only with Vite DEV.

Install in your other project (replace the absolute path with your checkout):

```powershell
npm install "C:/Users/User/Desktop/projects/pet/OxfordEnglish/packages/game-sdk"
```

Alternatively run `npm pack ./packages/game-sdk --pack-destination <folder>` in
DayEnglish, then install the generated `.tgz` in the other project. No npm
publication is required. Keep `gameId` and `releaseId` identical to the host registry.
For the built-in local entry use `integration-demo`, `1.0.0`, port 5188. For your
real game register its own identity/origin; do not accept arbitrary URL query
parameters as production catalogue entries or parent origins.

```js
import { connectDayEnglish } from '@dayenglish/game-sdk';

const platform = connectDayEnglish({
  hostOrigin: 'http://localhost:5173', // exact trusted origin; production: https://dayenglish.ru
  gameId: 'integration-demo',
  releaseId: '1.0.0',
});
const context = await platform.ready;
let saved = await platform.request('save.load', { slotId: '0' });
// Validate saved.schemaVersion before interpreting saved.payload.

const operationId = crypto.randomUUID();
const request = {
  slotId: '0',
  baseRevision: saved?.revision ?? 0,
  operationId,
  schemaVersion: 1,
  payload: { chapter: 'intro', checkpoint: 1 },
};
const result = await platform.request('save.write', request);
// On an uncertain timeout, retry exactly request, including operationId.
// Use the returned revision for the next, different checkpoint.

await platform.request('vocabulary.capture', {
  term: 'It depends', translation: 'Зависит от ситуации',
  context: 'It depends on the weather.',
});

const answer = await platform.request('translation.open', {
  text: 'I was reading when the phone rang.',
});
// A trusted DayEnglish dialog asks the user to translate; no hidden AI call.

platform.onEvent(({ type }) => {
  // Pause/resume your scene and audio. On closed, stop using this connection.
  console.log(type);
});
// Call platform.close() when destroying the game.
```

For Phaser: initialize once outside scene restarts, use scene pause/resume hooks.
For Three.js: initialize outside the animation loop, suspend simulation/audio on
pause. Never call save/translation each animation frame. Save at checkpoints,
serialize writes, and keep pending operation IDs until acknowledged.

## Contract

`index.d.ts` is the typed public method catalogue. Messages are JSON-compatible
structured data over exact-origin `postMessage`, channel `dayenglish.game`,
protocol major 1. A host-generated launch ID binds each connection. Required
request fields: `channel`, `version`, `type=request`, `launchId`, `requestId`,
`method`, `payload`. The SDK handles handshake, timeouts, request correlation,
trusted input signals and lifecycle. `ready.capabilities` reports implemented
areas; it does not promise network access, an active subscription or a provider.

| Method | Meaning |
|---|---|
| save.load / save.write | Local JSON checkpoint, slots `0`–`7`, 256 KiB payload maximum, local CAS revision |
| save.cloud | Explicit push or pull; requires account, writes require trial/Pro, reads survive expiry |
| save.resolve | Trusted conflict dialog; choose local/cloud, preserve the other in an unused local slot |
| content.access | Server check of a registered resource; result is informational, not DRM |
| content.asset | Server-approved short-lived asset URL; private chapter files must be separate from the public game |
| vocabulary.capture | Editable confirmation; duplicates preserve personal translation and SRS schedule |
| translation.open | User-triggered translation; free or managed/BYOK through DayEnglish, never returns keys |
| learning.report | Deduplicated local educational event, only declared/registered skill tags |

Cloud pull refuses to replace dirty local progress. Catch `conflict`, ask
`save.resolve`, then reload the local slot and interpret its schema before
continuing. Conflict resolution can fail if all eight local slots are occupied.
Its response includes `backupSlotId`: expose a way to load that slot in the game's
save selector. Local and cloud revisions are different; only use the local
revision returned by the SDK. Never replace an unknown/newer save schema with
an empty world. Each game is responsible for its own content/save migrations.

`learning.report` uses a stable activityId and itemVersion, unique eventId per
attempt and runId per playthrough. Re-delivery uses the same eventId. Send hint/AI
flags honestly. Repeated runs of the same item do not count as fresh knowledge.
Game results do not update FSRS or mark course days complete. Time is bounded
by host visibility/focus/idle checks; it is an estimate, not anti-cheat evidence.

Errors include `conflict`, `stale_owner`, `cancelled`, `closed`, `timeout`,
`rate_limit`, `busy`, `no_plan`, `unauthorized`, `offline`, `unavailable`,
`not_found`, `no_backup_slot`, `invalid_skill`, `invalid_or_unavailable`.
Preserve input on errors. Do not turn a network failure into a Pro paywall.
Card/translation cancellation normally returns `status: cancelled`; forced
closure/timeouts reject the request. Translation results are only returned when
the user chooses Return to game; Cancel/Escape returns no text.

## Host and server configuration

The host reads `/v1/games/catalog`; the default server does not enable the game
API. Before deploying this API revision, run the normal additive YDB migration
(adds `game_saves`, also used for account deletion). Enable the game routes with
`GAMES_ENABLED=true` and `GAMES_CATALOG_JSON` when the registry is ready.
This change does not perform those operations. The local in-memory API needs no
migration. Do not launch local tests with production database credentials.

Registry example:

```json
[
  {
    "gameId": "grammar-adventure",
    "releaseId": "1.0.0",
    "title": "Grammar Adventure",
    "entryUrl": "https://grammar.example.net/releases/1.0.0/index.html",
    "skills": ["grammar.past-vs-continuous"],
    "resources": [
      { "id": "intro", "access": "public" },
      { "id": "chapter-2", "access": "pro", "assets": [
        { "id": "chapter-data", "key": "grammar-adventure/1.0.0/chapter-2.json" }
      ] }
    ]
  }
]
```

`assets.key` is server-only. For signed downloads set `GAMES_S3_BUCKET` to a
private game-content bucket, using the existing S3 credentials/endpoint settings.
Do not mix private chapter JSON into public JS or ship it inside the demo PAK.
Use `content.asset` after checking availability, then fetch the URL from the game.
Bucket CORS must allow the exact game origin, and the game's CSP connect-src must
allow that bucket. URLs expire within 120 seconds and no later than plan expiry;
they are bearer URLs, not permanent licenses. Do not log them. Already downloaded
content cannot be reliably revoked. No offline-Pro license is implemented.

Serve games on isolated origins, never the app origin. Configure HTTPS, immutable
release paths, CSP (approved assets/scripts/connections), frame-ancestors for the
DayEnglish origin, MIME/encoding for WASM and no native/plugin permissions. The
host sandbox blocks top navigation, popups and unrelated permissions. No external
scripts or publisher updates should bypass review. There is no automated
publishing pipeline/marketplace in v0.1.

The `/games` route and navbar entry are controlled by the catalog rollout.
Static production hosting needs a fallback for `/games/:gameId` or generated
aliases for approved IDs; the local Vite route alone does not configure a CDN.
Stage/prove deep links before advertising them.

## Explicit v0.1 boundaries

- Android can open approved Lumi releases in a dedicated WebView. The game uses
  the same SDK and runs without access to Capacitor. The shell fills the available
  app window and does not expose the window expansion capability. Other game
  origins require an explicit Android allowlist entry.
- No Phaser/Three.js renderer is bundled into DayEnglish. The sample tests the
  actual SDK/host with plain JS; engines and Godot are not certified by this test.
- Local saves, explicit cloud sync, dictionary, translation UI and local progress
  are implemented. Cross-device learning-event/time aggregation is not yet.
- Asset delivery requires private bucket provisioning and deployment. None was
  performed by adding this code; YDB runtime integration needs infrastructure QA.
- Game-file offline downloading, signed offline Pro leases, achievements, user
  vocabulary export, native engines, public authors and payments per game are not
  implemented. They require new capabilities, not direct access to app internals.
- First-time registration adopts guest game records; ordinary login does not
  silently adopt them. Logout retains local records; account handover/deletion
  clears them under the existing retention rules. Storage failure can prevent
  guest adoption; original guest records are kept rather than discarded.
- Manual DayEnglish backup format v5 includes the current owner's game records.
  Import rebinds them to the local owner, keeps existing save slots unchanged and
  resets cloud revision metadata. Imported saves need an explicit cloud push or
  conflict resolution; importing a backup never uploads automatically.

See the example project and `src/features/games` for the host implementation.
Do not couple your game to these internal files; depend on this package only.
