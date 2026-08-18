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
      { path: '/settings', element: <SettingsPage /> },
      { path: '/kitchen-sink', element: <KitchenSinkPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
