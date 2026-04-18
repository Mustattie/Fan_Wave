export const Colors = {
  dark: {
    background: '#0f0f1a',
    surface: '#1e1e38',
    surfaceLight: '#2a2a4a',
    tabBar: '#16162a',
    accent: '#6c5ce7',
    accentLight: '#b8b0f0',
    accentGreen: '#00c853',
    accentGreenDark: '#004d25',
    text: '#ffffff',
    textSecondary: '#9999bb',
    textMuted: '#7a7a99',
    border: '#2a2a4a',
    error: '#ff4444',
    warning: '#ffc107',
    success: '#00c853',
    nfl: '#0096ff',
    nba: '#ff8c00',
    soccer: '#00c853',
    mlb: '#cc0000',
    nhl: '#000080',
  },
};

export type SportColor = keyof Pick<typeof Colors.dark, 'nfl' | 'nba' | 'soccer' | 'mlb' | 'nhl'>;
