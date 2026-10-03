// Build 33 (2026-10-02): Sentry events carried `app_version` but never
// `build_number`, because expo-constants 18 dropped `nativeBuildVersion`.
// buildTags() now reads expo-application first. These cases pin the source
// order so the tag cannot silently vanish again.

type ErrorReporting = typeof import('../lib/errorReporting');

function loadWith(applicationBuild: string | null, constantsBuild?: string): ErrorReporting {
  let mod: ErrorReporting | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-application', () => ({
      __esModule: true,
      nativeApplicationVersion: '1.0.0',
      nativeBuildVersion: applicationBuild,
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: '1.0.0' }, nativeBuildVersion: constantsBuild },
    }));
    mod = require('../lib/errorReporting');
  });
  return mod!;
}

describe('buildTags', () => {
  it('prefers expo-application over the legacy Constants field when both exist', () => {
    const tags = loadWith('33', '32').buildTags();
    expect(tags.build_number).toBe('33');
    expect(tags.app_version).toBe('1.0.0');
    expect(typeof tags.platform).toBe('string');
  });

  it('falls back to the legacy Constants field when expo-application has no value', () => {
    expect(loadWith(null, '32').buildTags().build_number).toBe('32');
  });

  it('omits build_number rather than tagging a null when neither source has it', () => {
    const tags = loadWith(null).buildTags();
    expect(tags).not.toHaveProperty('build_number');
    expect(tags.app_version).toBe('1.0.0');
  });
});
