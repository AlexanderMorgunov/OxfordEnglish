import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { AppLayout } from '@/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';

// Everything past the dashboard is lazy so the first paint doesn't parse the reader, grammar,
// settings, vocabulary, etc. Named exports are mapped to the default a lazy chunk expects.
const PlacementPage = lazy(() => import('@/pages/PlacementPage').then((m) => ({ default: m.PlacementPage })));
const DayPage = lazy(() => import('@/pages/DayPage').then((m) => ({ default: m.DayPage })));
const GrammarIndexPage = lazy(() => import('@/pages/GrammarReferencePage').then((m) => ({ default: m.GrammarIndexPage })));
const GrammarArticlePage = lazy(() => import('@/pages/GrammarReferencePage').then((m) => ({ default: m.GrammarArticlePage })));
const ReviewPage = lazy(() => import('@/pages/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const CheckpointPage = lazy(() => import('@/pages/CheckpointPage').then((m) => ({ default: m.CheckpointPage })));
const ProgressPage = lazy(() => import('@/pages/ProgressPage').then((m) => ({ default: m.ProgressPage })));
const VocabularyPage = lazy(() => import('@/pages/VocabularyPage').then((m) => ({ default: m.VocabularyPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SupportPage = lazy(() => import('@/pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const CreditsPage = lazy(() => import('@/pages/CreditsPage').then((m) => ({ default: m.CreditsPage })));
const FeedbackPage = lazy(() => import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })));
const LibraryPage = lazy(() => import('@/pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const BookReaderPage = lazy(() => import('@/pages/BookReaderPage').then((m) => ({ default: m.BookReaderPage })));
const CatalogReaderPage = lazy(() => import('@/pages/CatalogReaderPage').then((m) => ({ default: m.CatalogReaderPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const KitchenSinkPage = lazy(() => import('@/pages/KitchenSinkPage').then((m) => ({ default: m.KitchenSinkPage })));

const routes: RouteObject[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/placement', element: <PlacementPage /> },
  { path: '/course/:unitId/day/:dayId', element: <DayPage /> },
  { path: '/grammar', element: <GrammarIndexPage /> },
  { path: '/grammar/:articleId', element: <GrammarArticlePage /> },
  { path: '/review', element: <ReviewPage /> },
  { path: '/checkpoint/:unitId', element: <CheckpointPage /> },
  { path: '/progress', element: <ProgressPage /> },
  { path: '/vocabulary', element: <VocabularyPage /> },
  { path: '/library', element: <LibraryPage /> },
  { path: '/library/catalog/:catalogId', element: <CatalogReaderPage /> },
  { path: '/library/:bookId', element: <BookReaderPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/support', element: <SupportPage /> },
  { path: '/credits', element: <CreditsPage /> },
  { path: '/feedback', element: <FeedbackPage /> },
  // Dev-only playground — never routed in a production build.
  ...(import.meta.env.DEV ? [{ path: '/kitchen-sink', element: <KitchenSinkPage /> }] : []),
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter([{ element: <AppLayout />, children: routes }]);
