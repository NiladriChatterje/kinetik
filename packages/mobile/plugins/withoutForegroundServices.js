// Strips the typed foreground services that expo-audio and expo-location
// declare for background playback and background location. Kinetik uses
// neither: voice notes play only while the chat is open, and location is
// read in the foreground. Leaving the services in the manifest would make
// Play Console demand a foreground-service declaration (with a video) for
// features the app does not have, and Android 14+ would still require the
// matching FOREGROUND_SERVICE_* permissions, which app.json blocks.
const { withAndroidManifest } = require('expo/config-plugins');

const SERVICES_TO_REMOVE = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.location.services.LocationTaskService',
];

module.exports = function withoutForegroundServices(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const application = manifest.application && manifest.application[0];
    if (!application) return mod;
    application.service = application.service || [];
    for (const name of SERVICES_TO_REMOVE) {
      const existing = application.service.find((s) => s.$ && s.$['android:name'] === name);
      if (existing) {
        existing.$['tools:node'] = 'remove';
      } else {
        application.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
      }
    }
    return mod;
  });
};
