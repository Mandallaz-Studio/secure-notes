/**
 * Complète app.json avec ce qui dépend du site de lecture des notes partagées.
 *
 * EXPO_PUBLIC_SHARE_BASE_URL (par ex. https://notes.exemple.fr, dans .env.local)
 * est le site où s'ouvrent les liens de partage. Quand elle est définie, l'app
 * se déclare aussi capable d'ouvrir elle-même les liens `<site>/s/…` (liens
 * d'app Android, liens universels iOS). Cela exige en plus, sur le site, les
 * fichiers `.well-known/assetlinks.json` et `.well-known/apple-app-site-association`
 * (voir PLAN.md, bilan de la phase 6).
 */
module.exports = ({ config }) => {
  const site = (process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').trim();
  const match = /^https:\/\/([^/?#\s]+)\/?$/.exec(site);
  if (!match) return config;
  const host = match[1];
  return {
    ...config,
    android: {
      ...config.android,
      intentFilters: [
        ...(config.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/s/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    ios: {
      ...config.ios,
      associatedDomains: [...(config.ios?.associatedDomains ?? []), `applinks:${host}`],
    },
  };
};
