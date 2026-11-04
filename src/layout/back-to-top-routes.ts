import { matchPath } from 'react-router-dom';

const ROUTES = [
  '/', '/grammar', '/grammar/:articleId', '/course/:unitId/day/:dayId',
  '/vocabulary', '/library', '/settings/:section?', '/about', '/progress',
  '/terms', '/privacy', '/credits', '/support', '/pro', '/feedback',
];

export const hasBackToTop = (pathname: string) => ROUTES.some(path => matchPath({ path, end: true }, pathname));
