import { createContext, use } from 'react';

/** Set by Popover so a child of the panel can dismiss it (e.g. a "select phrase" action). */
export const PopoverCloseContext = createContext<() => void>(() => {});

export const usePopoverClose = () => use(PopoverCloseContext);
