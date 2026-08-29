const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'GOOGLE_PAY_ENVIRONMENT';

/**
 * Pin the Google Pay sheet's environment into android/gradle.properties.
 *
 * `@google/react-native-make-payment` reads this at build time:
 *
 *   buildConfigField("String", "GOOGLE_PAY_ENVIRONMENT",
 *     project.findProperty("GOOGLE_PAY_ENVIRONMENT") ?: "TEST")
 *
 * It used to be hand-written into gradle.properties, which `expo prebuild`
 * silently erases when it regenerates android/. Setting it from a config
 * plugin makes it survive prebuild.
 *
 * Deliberately NOT tied to APP_ENV: a production *app build* is not the same
 * decision as putting the payment sheet into PRODUCTION, which charges real
 * cards and is only valid once the Google Pay & Wallet Console has approved
 * the app. Anything other than an explicit GOOGLE_PAY_ENVIRONMENT=PRODUCTION
 * stays on TEST — see PAYMENT_INTEGRATION.md step 10.
 */
module.exports = function withGooglePayEnvironment(config) {
  const value = process.env.GOOGLE_PAY_ENVIRONMENT === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';

  return withGradleProperties(config, (cfg) => {
    // Drop any existing entry so re-running prebuild doesn't stack duplicates.
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY),
    );

    cfg.modResults.push(
      { type: 'empty' },
      {
        type: 'comment',
        value: 'Google Pay sheet environment for @google/react-native-make-payment.',
      },
      {
        type: 'comment',
        // Plain ASCII only: Gradle parses .properties as ISO-8859-1.
        value: `Managed by plugins/withGooglePayEnvironment.js - set ${KEY}=PRODUCTION in the`,
      },
      {
        type: 'comment',
        value: 'build environment only after the Google Pay & Wallet Console approves the app.',
      },
      { type: 'property', key: KEY, value },
    );

    return cfg;
  });
};
