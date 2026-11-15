# Extension de navigateur « Secure Notes — Recevoir »

Affiche un QR code dans le navigateur. Depuis l'app, sur l'écran de partage d'une
note, « QR code » sur un lien → on scanne → la note s'ouvre dans un nouvel onglet,
sur le site de lecture (`EXPO_PUBLIC_SHARE_BASE_URL`).

Chrome, Edge, Brave… et Firefox (128 ou plus) : un seul paquet Manifest V3.

## Construire

```bash
npm run extension
```

Le paquet est écrit dans `extension/dist`. Il reprend `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` et `EXPO_PUBLIC_SHARE_BASE_URL` de `.env.local` (ou de
l'environnement), comme la page de lecture. Le code du protocole est celui de l'app
(`src/share/handoff.ts`, `src/share/link.ts`, `src/crypto/*`), assemblé par esbuild avec
libsodium en WebAssembly.

## Installer pour essayer

- **Chrome / Edge** : `chrome://extensions` → « Mode développeur » → « Charger l'extension
  non empaquetée » → dossier `extension/dist`.
- **Firefox** : `about:debugging#/runtime/this-firefox` → « Charger un module
  complémentaire temporaire » → `extension/dist/manifest.json`.

Publication : zipper le contenu de `extension/dist` (Chrome Web Store, addons.mozilla.org).

## Prérequis côté serveur

La migration `supabase/migrations/20261118000000_handoffs.sql` doit être appliquée sur
l'instance. Sans elle, la fenêtre affiche « instance pas à jour ».

## Sécurité

- **Permissions** : `storage` seulement (instance personnalisée). Aucune permission
  d'hôte, aucun script de contenu, aucun accès aux onglets ouverts. Ouvrir un onglet
  (`tabs.create`) n'en demande pas.
- **CSP** : `default-src 'none'`, scripts du paquet uniquement (`wasm-unsafe-eval` pour
  libsodium), requêtes en https seulement.
- **Secrets** : le secret et la paire de clés du QR code ne vivent que dans la fenêtre ;
  la fermer, ou recevoir un lien, les efface. Un code expire après 5 minutes et ne sert
  qu'une fois.
- **Aucune adresse reçue n'est ouverte telle quelle** : l'extension reçoit un identifiant
  de partage et un fragment, les valide, et reconstruit elle-même le lien sur le site de
  lecture fixé à la compilation.

Le protocole est décrit en tête de `src/share/handoff.ts` et dans `AUDIT-SECURITE.md`.
