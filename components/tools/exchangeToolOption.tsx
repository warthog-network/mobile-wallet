import SafeTradeTool from './SafeTradeTool';

/** Sideload only. The Play bundle replaces this file with an empty shim. */
export const exchangeTool = {
  id: 'exchange' as const,
  label: 'SafeTrade',
  Screen: SafeTradeTool,
};
