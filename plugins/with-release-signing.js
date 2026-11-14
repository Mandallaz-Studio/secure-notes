const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signature des builds « release » locaux par une clé propre à l'app.
 *
 * Sans ce plugin, Expo signe les builds release avec la clé de débogage de
 * React Native, publique : n'importe qui pourrait signer une app du même nom
 * de paquet, et le site (assetlinks.json) ne peut donc pas la désigner comme
 * seule app autorisée à ouvrir les liens de partage.
 *
 * La clé et ses mots de passe restent hors du dépôt, en propriétés Gradle
 * (par exemple dans ~/.gradle/gradle.properties) :
 *
 *   SECURE_NOTES_RELEASE_STORE_FILE=/chemin/absolu/release.keystore
 *   SECURE_NOTES_RELEASE_STORE_PASSWORD=…
 *   SECURE_NOTES_RELEASE_KEY_ALIAS=secure-notes
 *   SECURE_NOTES_RELEASE_KEY_PASSWORD=…
 *
 * Sans ces propriétés, le build release reste signé par la clé de débogage
 * (ses liens d'app ne seront pas vérifiés). EAS Build applique sa propre clé.
 */
const SIGNING = `
        if (findProperty('SECURE_NOTES_RELEASE_STORE_FILE')) {
            release {
                storeFile file(findProperty('SECURE_NOTES_RELEASE_STORE_FILE'))
                storePassword findProperty('SECURE_NOTES_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('SECURE_NOTES_RELEASE_KEY_ALIAS')
                keyPassword findProperty('SECURE_NOTES_RELEASE_KEY_PASSWORD')
            }
        }`;

const MARKER = "findProperty('SECURE_NOTES_RELEASE_STORE_FILE')";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes(MARKER)) return mod;

    const configs = /signingConfigs \{\n(\s+debug \{[^}]*\})/;
    const release = /(release \{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!configs.test(gradle) || !release.test(gradle)) {
      throw new Error('with-release-signing : build.gradle a changé de forme, plugin à adapter.');
    }
    gradle = gradle.replace(configs, (all) => `${all}${SIGNING}`);
    gradle = gradle.replace(
      release,
      `$1signingConfig ${MARKER} ? signingConfigs.release : signingConfigs.debug`,
    );
    mod.modResults.contents = gradle;
    return mod;
  });
};
