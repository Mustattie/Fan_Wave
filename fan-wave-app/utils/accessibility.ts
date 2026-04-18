import { Platform } from 'react-native';

/**
 * Standard accessibility props for common interactive patterns.
 * Use these to ensure consistency across the app.
 */

export const a11y = {
  /** Button-like touchable */
  button: (label: string) => ({
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
  }),

  /** Link-like touchable */
  link: (label: string) => ({
    accessibilityRole: 'link' as const,
    accessibilityLabel: label,
  }),

  /** Text input */
  input: (label: string, hint?: string) => ({
    accessibilityLabel: label,
    ...(hint ? { accessibilityHint: hint } : {}),
  }),

  /** Image */
  image: (label: string) => ({
    accessibilityRole: 'image' as const,
    accessibilityLabel: label,
  }),

  /** Header text */
  header: (label?: string) => ({
    accessibilityRole: 'header' as const,
    ...(label ? { accessibilityLabel: label } : {}),
  }),

  /** Tab bar item */
  tab: (label: string, selected: boolean) => ({
    accessibilityRole: 'tab' as const,
    accessibilityLabel: label,
    accessibilityState: { selected },
  }),

  /** Toggle/switch */
  toggle: (label: string, value: boolean) => ({
    accessibilityRole: 'switch' as const,
    accessibilityLabel: label,
    accessibilityState: { checked: value },
  }),

  /** Live region for dynamic content updates (scores, new messages) */
  liveRegion: (polite: boolean = true) => ({
    accessibilityLiveRegion: (polite ? 'polite' : 'assertive') as 'polite' | 'assertive',
  }),

  /** Hidden from screen reader (decorative elements) */
  hidden: () => ({
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  }),
};
