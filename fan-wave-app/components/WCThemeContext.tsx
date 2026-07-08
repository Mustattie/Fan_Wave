import React, { createContext, useContext } from 'react';

// v9.0 pivot: `world_cup_mode` feature flag was removed. The provider
// previously toggled a green tournament accent when the flag was active;
// with the WC tab gone we ship the default (purple) palette permanently.
// The context is kept in place so existing `useWCTheme()` consumers don't
// need to be rewritten in one pass — they will be migrated to Colors.dark
// in v9.1 and this file can then be deleted.
interface WCTheme {
  isWorldCupMode: boolean;
  accent: string;
  accentDark: string;
}

const DEFAULT_THEME: WCTheme = {
  isWorldCupMode: false,
  accent: '#6c5ce7',
  accentDark: '#4a3db5',
};

const WCThemeContext = createContext<WCTheme>(DEFAULT_THEME);

export function WCThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <WCThemeContext.Provider value={DEFAULT_THEME}>
      {children}
    </WCThemeContext.Provider>
  );
}

export function useWCTheme(): WCTheme {
  return useContext(WCThemeContext);
}
