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

// On the .online mirror, carry this origin's data to the canonical .ru and redirect — WITHOUT booting
// the app, so we never register a service worker or log analytics for a domain we're abandoning.
if (isMirrorHost()) {
  void migrateThenRedirect();
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
