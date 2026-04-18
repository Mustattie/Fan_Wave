import React, { createContext, useContext, useState, useEffect } from 'react';
import { isFeatureActive } from '@/lib/featureFlags';

interface WCTheme {
  isWorldCupMode: boolean;
  accent: string;      // #00c853 when WC active, #6c5ce7 otherwise
  accentDark: string;
}

const WCThemeContext = createContext<WCTheme>({
  isWorldCupMode: false,
  accent: '#6c5ce7',
  accentDark: '#4a3db5',
});

export function WCThemeProvider({ children }: { children: React.ReactNode }) {
  const [isWorldCupMode, setIsWorldCupMode] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkFlag() {
      try {
        const active = await isFeatureActive('world_cup_mode');
        if (mounted) {
          setIsWorldCupMode(active);
        }
      } catch {
        // Silently default to non-WC mode
      }
    }

    checkFlag();

    return () => {
      mounted = false;
    };
  }, []);

  const theme: WCTheme = {
    isWorldCupMode,
    accent: isWorldCupMode ? '#00c853' : '#6c5ce7',
    accentDark: isWorldCupMode ? '#004d25' : '#4a3db5',
  };

  return (
    <WCThemeContext.Provider value={theme}>
      {children}
    </WCThemeContext.Provider>
  );
}

export function useWCTheme(): WCTheme {
  return useContext(WCThemeContext);
}
