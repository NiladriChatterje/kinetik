#!/usr/bin/env node
/**
 * Build the Play Store AAB on this machine, signed with the Play upload key,
 * without an EAS cloud build.
 *
 * Needs the upload key downloaded once with `npx eas credentials -p android`
 * (production profile → credentials.json → Download credentials from EAS).
 * That writes credentials.json and credentials/android/keystore.jks here in
 * packages/mobile; both are gitignored.
 *
 * - APP_ENV and EXPO_PUBLIC_API_URL come from eas.json's production profile,
 *   so a local build is configured like a cloud one.
 * - The key reaches Gradle as android.injected.signing.* properties (what
 *   Android Studio's signed-bundle wizard uses), so android/app/build.gradle
 *   stays untouched and a prebuild cannot drop the setup.
 * - Gradle is started with java -jar gradle-wrapper.jar rather than
 *   gradlew.bat, so the passwords are passed as exact arguments and never
 *   parsed by cmd.
 * - Two workers, no parallel projects, and ninja capped at 4 compiles per
 *   native build (scripts/limit-native-jobs.init.gradle): more makes clang
 *   run out of memory on a 16 GB machine during a cold native compile.
 *
 * Usage (from packages/mobile):
 *   node scripts/build-play-aab.js            offline, all four ABIs
 *   node scripts/build-play-aab.js --online   let Gradle download dependencies
 *
 * Output: android/app/build/outputs/bundle/release/app-release.aab
 * Bump versionCode in app.json and android/app/build.gradle first: Play
 * rejects a versionCode it has seen, and EAS autoIncrement does not run here.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const androidDir = path.join(projectDir, 'android');

function fail(message) {
  console.error(`\n[build-play-aab] ${message}\n`);
  process.exit(1);
}

// ─── Upload key ──────────────────────────────────────────────────
const credentialsPath = path.join(projectDir, 'credentials.json');
if (!fs.existsSync(credentialsPath)) {
  fail(
    'credentials.json not found. Download the upload key once from packages/mobile:\n' +
      '  npx eas credentials -p android\n' +
      '  → production → credentials.json → Download credentials from EAS to credentials.json',
  );
}
const keystore = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).android?.keystore;
if (!keystore?.keystorePath || !keystore.keystorePassword || !keystore.keyAlias || !keystore.keyPassword) {
  fail('credentials.json has no complete android.keystore entry.');
}
const keystoreFile = path.resolve(projectDir, keystore.keystorePath);
if (!fs.existsSync(keystoreFile)) fail(`Keystore not found at ${keystoreFile}`);

// ─── Production config, as the cloud build gets it ───────────────
const productionEnv = JSON.parse(fs.readFileSync(path.join(projectDir, 'eas.json'), 'utf8')).build
  ?.production?.env;
if (!productionEnv?.APP_ENV || !productionEnv.EXPO_PUBLIC_API_URL) {
  fail('eas.json build.production.env needs APP_ENV and EXPO_PUBLIC_API_URL.');
}

// ─── Version check ───────────────────────────────────────────────
const gradleVersionCode = Number(
  /versionCode\s+(\d+)/.exec(fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8'))?.[1],
);
const appJsonVersionCode = JSON.parse(fs.readFileSync(path.join(projectDir, 'app.json'), 'utf8')).expo
  ?.android?.versionCode;
if (gradleVersionCode !== appJsonVersionCode) {
  fail(
    `versionCode differs: android/app/build.gradle has ${gradleVersionCode}, app.json has ${appJsonVersionCode}.`,
  );
}

// ─── Build ───────────────────────────────────────────────────────
const online = process.argv.includes('--online');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';

console.log(
  `[build-play-aab] versionCode ${gradleVersionCode}, APP_ENV=${productionEnv.APP_ENV}, ` +
    `API ${productionEnv.EXPO_PUBLIC_API_URL}, ${online ? 'online' : 'offline'}`,
);

const result = spawnSync(
  java,
  [
    '-Xmx64m',
    '-Xms64m',
    '-Dorg.gradle.appname=gradlew',
    '-jar',
    path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
    ':app:bundleRelease',
    '--init-script',
    path.join(__dirname, 'limit-native-jobs.init.gradle'),
    ...(online ? [] : ['--offline']),
    '--no-daemon',
    '-Dorg.gradle.workers.max=2',
    '-Dorg.gradle.parallel=false',
    `-Pandroid.injected.signing.store.file=${keystoreFile}`,
    `-Pandroid.injected.signing.store.password=${keystore.keystorePassword}`,
    `-Pandroid.injected.signing.key.alias=${keystore.keyAlias}`,
    `-Pandroid.injected.signing.key.password=${keystore.keyPassword}`,
  ],
  {
    cwd: androidDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_ENV: productionEnv.APP_ENV,
      EXPO_PUBLIC_API_URL: productionEnv.EXPO_PUBLIC_API_URL,
    },
  },
);

if (result.error) fail(`Could not start Gradle: ${result.error.message}`);
if (result.status !== 0) fail(`Gradle failed with exit code ${result.status}.`);

console.log(
  `\n[build-play-aab] Done: ${path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')}`,
);
