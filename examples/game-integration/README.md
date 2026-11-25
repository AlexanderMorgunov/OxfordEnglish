# Separate game integration fixture

Run `npm start` in this folder or `npm run games:demo` at the repository root.
Open DayEnglish `/games/integration-demo` on the local Vite server. The parent
origin is passed to this **local-only fixture**; a real game must pin its trusted
host origin in configuration. The fixture accepts only localhost/127.0.0.1.

This scene is deliberately plain JavaScript, so the platform API is not tied to
Phaser, Three.js or React. Replace the scene with your game, retaining one SDK
connection. The SDK is a separate installable package; see
[its documentation](../../packages/game-sdk/README.md).

The fixture works without a backend for local saves, capture and local results.
Pro checks/cloud actions need the separately configured local API and a matching
server registry. An unavailable API is not simulated as Pro. Translation is
explicit, through the normal trusted dialog; testing it may call the selected
provider. No credentials are embedded in this project.
