import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './app.css';
import { router } from '@/router';
import { initAnalytics } from '@/features/analytics/analytics';
import { initMetrica } from '@/features/analytics/metrica';
import { initPwaInstall } from '@/features/pwa/install';
import { initAppUpdate } from '@/features/pwa/update';
import { initFeedback } from '@/features/feedback/service';
import { isMirrorHost, migrateThenRedirect } from '@/features/migration/sender';
import { isReceiverPath, receiveMigration } from '@/features/migration/receiver';

// Migration hooks run BEFORE the app boots, so neither the .online sender nor the .ru receiver
// registers a service worker or logs analytics for what is only a data-handoff hop.
// `?stay` is an escape hatch: open the .online mirror WITHOUT migrating/redirecting (support/debug).
const stayOnMirror = new URLSearchParams(location.search).has('stay');
if (isMirrorHost() && !stayOnMirror) {
  // .online mirror: carry this origin's data to canonical .ru, then redirect.
  void migrateThenRedirect();
} else if (isReceiverPath()) {
  // .ru receiver (served as index.html at /migrate): import the handed-off snapshot, then redirect.
  void receiveMigration();
} else {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root not found');

  initAnalytics();
  initMetrica();
  initPwaInstall();
  initAppUpdate();
  initFeedback();

  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
