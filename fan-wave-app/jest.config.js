module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*)',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // '/\\.claude/' keeps git worktrees created under fan-wave-app/.claude/
  // (each carrying its own copy of __tests__) out of the main checkout's run.
  testPathIgnorePatterns: ['/node_modules/', '/tests/load/', '/\\.claude/'],
};
