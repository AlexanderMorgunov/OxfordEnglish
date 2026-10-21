import { lazyPage } from '@/shared/lib/lazy-page';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { AppLayout } from '@/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';

// Everything past the dashboard is lazy so the first paint doesn't parse the reader, grammar,
// settings, vocabulary, etc. Named exports are mapped to the default a lazy chunk expects.
const PlacementPage = lazyPage(() => import('@/pages/PlacementPage').then((m) => ({ default: m.PlacementPage })));
const DayPage = lazyPage(() => import('@/pages/DayPage').then((m) => ({ default: m.DayPage })));
const GrammarIndexPage = lazyPage(() => import('@/pages/GrammarReferencePage').then((m) => ({ default: m.GrammarIndexPage })));
const GrammarArticlePage = lazyPage(() => import('@/pages/GrammarReferencePage').then((m) => ({ default: m.GrammarArticlePage })));
const ReviewPage = lazyPage(() => import('@/pages/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const CheckpointPage = lazyPage(() => import('@/pages/CheckpointPage').then((m) => ({ default: m.CheckpointPage })));
const ProgressPage = lazyPage(() => import('@/pages/ProgressPage').then((m) => ({ default: m.ProgressPage })));
const VocabularyPage = lazyPage(() => import('@/pages/VocabularyPage').then((m) => ({ default: m.VocabularyPage })));
const TextWorkbenchPage = lazyPage(() => import('@/pages/TextWorkbenchPage').then((m) => ({ default: m.TextWorkbenchPage })));
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SupportPage = lazyPage(() => import('@/pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const CreditsPage = lazyPage(() => import('@/pages/CreditsPage').then((m) => ({ default: m.CreditsPage })));
const FeedbackPage = lazyPage(() => import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })));
const PrivacyPage = lazyPage(() => import('@/pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const LibraryPage = lazyPage(() => import('@/pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const BookReaderPage = lazyPage(() => import('@/pages/BookReaderPage').then((m) => ({ default: m.BookReaderPage })));
const CatalogReaderPage = lazyPage(() => import('@/pages/CatalogReaderPage').then((m) => ({ default: m.CatalogReaderPage })));
const AboutPage = lazyPage(() => import('@/pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const TermsPage = lazyPage(() => import('@/pages/TermsPage').then((m) => ({ default: m.TermsPage })));
const ProPage = lazyPage(() => import('@/pages/ProPage').then((m) => ({ default: m.ProPage })));
const BillingSuccessPage = lazyPage(() => import('@/pages/BillingReturnPage').then((m) => ({ default: m.BillingSuccessPage })));
const BillingFailPage = lazyPage(() => import('@/pages/BillingReturnPage').then((m) => ({ default: m.BillingFailPage })));
const NotFoundPage = lazyPage(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const KitchenSinkPage = lazyPage(() => import('@/pages/KitchenSinkPage').then((m) => ({ default: m.KitchenSinkPage })));

const routes: RouteObject[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/placement', element: <PlacementPage /> },
  { path: '/course/:unitId/day/:dayId', element: <DayPage /> },
  { path: '/grammar', element: <GrammarIndexPage /> },
  { path: '/grammar/:articleId', element: <GrammarArticlePage /> },
  { path: '/review', element: <ReviewPage /> },
  { path: '/checkpoint/:unitId', element: <CheckpointPage /> },
  { path: '/progress', element: <ProgressPage /> },
  { path: '/vocabulary', element: <VocabularyPage /> },
  { path: '/vocabulary/text', element: <TextWorkbenchPage /> },
  { path: '/library', element: <LibraryPage /> },
  { path: '/library/catalog/:catalogId', element: <CatalogReaderPage /> },
  { path: '/library/:bookId', element: <BookReaderPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/support', element: <SupportPage /> },
  { path: '/credits', element: <CreditsPage /> },
  { path: '/feedback', element: <FeedbackPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/pro', element: <ProPage /> },
  // Where the acquirer returns the payer. Configured in the Robokassa merchant panel as SuccessURL /
  // FailURL — changing these paths means changing them there too.
  { path: '/billing/success', element: <BillingSuccessPage /> },
  { path: '/billing/fail', element: <BillingFailPage /> },
  // Dev-only playground — never routed in a production build.
  ...(import.meta.env.DEV ? [{ path: '/kitchen-sink', element: <KitchenSinkPage /> }] : []),
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter([{ element: <AppLayout />, children: routes }]);
