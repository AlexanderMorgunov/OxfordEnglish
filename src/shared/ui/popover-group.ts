import { createContext } from 'react';

type PopoverGroupController = {
  activate: (close: () => void) => () => void;
  dismiss: () => boolean;
};

export const PopoverGroupContext = createContext<PopoverGroupController | null>(null);
