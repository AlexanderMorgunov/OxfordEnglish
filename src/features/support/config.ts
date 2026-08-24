/**
 * Donation payment link (currently a CloudTips ruble page), read from build-time env like the other
 * transports — set `VITE_SUPPORT_URL` in a gitignored `.env` (see `.env.example`) or the host's build
 * settings. While empty, the Support page shows a friendly "coming soon" state instead of a live button.
 *
 * Payments must live on the PWA, never inside the Telegram Mini App (Telegram ToS),
 * so this is always an external link that opens in the browser.
 */
export const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL ?? '';
