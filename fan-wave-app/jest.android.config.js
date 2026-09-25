// Same config as jest.config.js under the Android jest-expo preset
// (Platform.OS === 'android'). The default preset is iOS, so running both
// gives platform-branch coverage without a device. Usage:
//   npx jest -c jest.android.config.js
//
// jest-expo's per-platform presets (SDK 54) omit the babel `configFile`
// that the default preset sets, so react-native's flow-typed jest setup
// is not transformed; supply it explicitly.
const path = require('path');
const base = require('./jest.config.js');
const android = require('jest-expo/android/jest-preset.js');
// The key is a regex source ('\.[jt]sx?$'); look it up rather than
// re-typing it so a preset change fails loudly here.
const babelKey = Object.keys(android.transform).find((k) => Array.isArray(android.transform[k]));
if (!babelKey) throw new Error('jest-expo/android preset has no babel-jest transform entry');
const babelEntry = android.transform[babelKey];
module.exports = {
  ...base,
  preset: 'jest-expo/android',
  transform: {
    ...android.transform,
    [babelKey]: [
      babelEntry[0],
      { ...babelEntry[1], configFile: path.join(__dirname, 'node_modules/expo/internal/babel-preset.js') },
    ],
  },
};
