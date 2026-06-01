# Maestro fixtures

Test assets pushed onto the Android emulator before running scenarios.

## What to push

A short MP4 (~5 sec, <10 MB) used by scenarios 03 and 07 when they upload
a clip. Place it here as `qa-test-clip.mp4`.

## How to push to the emulator

Once the AVD is running:

```
adb push qa/maestro/fixtures/qa-test-clip.mp4 /sdcard/Movies/qa-test-clip.mp4
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Movies/qa-test-clip.mp4
```

The media-scanner broadcast makes the file appear in the device's
Gallery so Fan Sphere's "Pick from Library" picker finds it.

Verify it landed:
```
adb shell ls -la /sdcard/Movies/
```
