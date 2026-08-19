import { createBrowserRouter } from 'react-router-dom';

import { AppLayout } from '@/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { PlacementPage } from '@/pages/PlacementPage';
import { DayPage } from '@/pages/DayPage';
import { GrammarIndexPage, GrammarArticlePage } from '@/pages/GrammarReferencePage';
import { ReviewPage } from '@/pages/ReviewPage';
import { CheckpointPage } from '@/pages/CheckpointPage';
import { ProgressPage } from '@/pages/ProgressPage';
import { VocabularyPage } from '@/pages/VocabularyPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SupportPage } from '@/pages/SupportPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { BookReaderPage } from '@/pages/BookReaderPage';
import { CatalogReaderPage } from '@/pages/CatalogReaderPage';
import { KitchenSinkPage } from '@/pages/KitchenSinkPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
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
      { path: '/kitchen-sink', element: <KitchenSinkPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
