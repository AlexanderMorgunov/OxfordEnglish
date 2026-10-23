import { createContext } from 'react';
import { useSessionResults } from '@/features/progress/sessionResults';

export const ExerciseSessionContext = createContext(useSessionResults);
