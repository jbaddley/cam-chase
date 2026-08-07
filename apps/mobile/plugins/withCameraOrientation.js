const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Let a device rotation recreate the Android activity.
 *
 * Expo's default `MainActivity` lists `orientation` (and the screen-size flags)
 * in `android:configChanges`, so the activity *handles* rotation itself instead
 * of being recreated. That keeps React mounted across a rotation — but it also
 * means expo-camera's preview is never re-initialised for the new orientation,
 * so in landscape the viewfinder shows a sideways image. Dropping those flags
 * makes Android recreate the activity on rotation, which re-inits the camera the
 * right way up.
 *
 * The cost is a brief re-mount when you turn the phone. The app tolerates it
 * because its game state is server-derived and re-fetched on mount (see
 * CLAUDE.md), so a rotation lands you back on the same screen rather than losing
 * your place. Keyboard/uiMode changes stay handled — only the rotation-related
 * flags are removed.
 */
const ROTATION_FLAGS = new Set(['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout']);

module.exports = function withCameraOrientation(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    const activity = application?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (activity?.$?.['android:configChanges']) {
      activity.$['android:configChanges'] = activity.$['android:configChanges']
        .split('|')
        .filter((flag) => flag && !ROTATION_FLAGS.has(flag))
        .join('|');
    }
    return cfg;
  });
};
