# Secure Notes — plan de développement

> Document de reprise pour les prochaines sessions. Dernière mise à jour : 2026-11-13.
> État : **phases 0 et 1 terminées**. Prochaine étape : phase 2.

## 1. Objectif

App de prise de notes chiffrée de bout en bout, en React Native / Expo, avec synchro
cloud optionnelle via Supabase. Le serveur ne doit jamais voir de données en clair.

### Exigences (demande initiale)

- React Native + Expo.
- Données chiffrées sur l'appareil avant tout envoi.
- Récupération uniquement via une phrase de récupération.
- La phrase n'est affichée qu'une seule fois, puis plus jamais visible.
- Si l'utilisateur est encore connecté, il peut extraire ses données et recréer un compte.
- Algorithmes résistants au post-quantique.
- Secrets de déchiffrement dans le stockage sécurisé du téléphone.
- Supabase pour la synchro, avec adresse d'instance modifiable dans l'app.
- Mode hors ligne (aucune synchro externe).
- Interface épurée, édition riche (couleurs, surlignage, soulignage, italique, tailles
  de titre…), support Markdown souhaité.
- Catégories, archivage.
- Pièces jointes, quota global de 50 Mo par utilisateur, défini dans Supabase et
  modifiable par utilisateur.
- Thème clair / sombre avec adaptation automatique des couleurs de texte.
- Images collées dans les notes.
- Partage d'une note par lien unique, avec une clé propre à ce partage dans l'URL.

## 2. Décisions

### Prises par l'utilisateur (2026-11-13)

| Sujet | Décision |
|---|---|
| Longueur de la phrase | **24 mots** (et non 12 comme dans la demande initiale), pour une vraie marge post-quantique |
| Images collées | **Comptées dans le quota de 50 Mo**, comme les pièces jointes |
| Hébergement de la page de lecture des liens | Sous-domaine du domaine OVH de l'utilisateur ; un compte Cloudflare gratuit est disponible |
| App web complète | Seulement si elle peut être suffisamment sécurisée, sinon non |

### Prises par Claude (à contester si besoin)

| Sujet | Décision | Raison |
|---|---|---|
| App web complète | **Non en v1.** Le web sert uniquement à lire les liens partagés | Un navigateur n'a pas de stockage matériel sécurisé (exigence du projet), la clé serait exposée à la moindre faille XSS, et le code est resservi par le serveur à chaque visite. Le code crypto restera compatible web pour pouvoir y revenir |
| Dérivation de clé | Entropie de 256 bits de la phrase → HKDF, **sans Argon2id** | Avec 256 bits d'entropie, un étirement de clé n'apporte rien et Argon2id est lent sur mobile. (Le plan initial à 12 mots prévoyait Argon2id) |
| Chiffrement | XChaCha20-Poly1305, clés de 256 bits, **aucune cryptographie asymétrique** | Le symétrique 256 bits résiste à Grover ; sans RSA ni courbes elliptiques, rien n'est exposé à Shor. ML-KEM ne serait utile que pour un futur partage entre utilisateurs |
| Compte Supabase | Identifiant et mot de passe **dérivés de la phrase**, sans e-mail réel | Restaurer la phrase suffit à se reconnecter ; aucune donnée personnelle côté serveur |
| Format des notes | JSON TipTap stocké ; Markdown en raccourcis de frappe et en import/export | Markdown ne représente ni les couleurs ni le soulignage |
| Éditeur | TenTap (TipTap dans une WebView) | Couvre toute la mise en forme demandée ; à valider en phase 0 |
| Couleurs de texte | Jetons de palette et non valeurs hexadécimales | Reste lisible en thème clair comme en sombre |
| Base locale | SQLite chiffrée (SQLCipher via `expo-sqlite`), source de vérité | Mode hors ligne natif, données chiffrées au repos |
| Conflits de synchro | Dernier écrit gagne, par note, avec copie de conflit | Simple et sans perte silencieuse |
| Hébergement web | **Cloudflare Pages** (offre gratuite), sous-domaine relié par un CNAME dans la zone DNS OVH | Statique, gratuit, pas besoin de déplacer le domaine |
| Plateformes | iOS et Android | Voir ligne « App web complète » |

### Encore ouvert

- Nom exact du sous-domaine (par ex. `notes.<domaine>`) : à fournir avant la phase 6.
- Nom et identifiant de l'app (bundle id) : à fixer en phase 0.

## 3. Architecture

### Hiérarchie des clés

```
Phrase de 24 mots (BIP39, 256 bits d'entropie) — affichée une fois, jamais stockée
        │
        ▼
Clé maîtresse (256 bits) ── stockée dans Keychain / Keystore (expo-secure-store)
        │ HKDF, avec séparation de domaine
        ├── identifiant de compte   (public, sert de login Supabase)
        ├── secret d'authentification (mot de passe Supabase)
        ├── clé d'enveloppe         (chiffre les clés par note / par fichier)
        └── clé de la base locale   (SQLCipher)

Par note et par fichier : clé aléatoire de 256 bits, chiffrée avec la clé d'enveloppe.
Par partage : clé aléatoire de 256 bits, indépendante, placée dans le fragment d'URL.
```

- Chiffrement authentifié : XChaCha20-Poly1305, nonce aléatoire de 192 bits.
- Gros fichiers : chiffrement par blocs (secretstream de libsodium).
- Bibliothèque visée : `react-native-libsodium` (repli web sur libsodium-wrappers pour
  la page de lecture). Alternative si problème : `@noble/ciphers` + `@noble/hashes`.
- Le serveur ne voit que : identifiants, dates, tailles. Titres, catégories, état
  archivé et contenu sont dans le blob chiffré.

### Cycle de vie de la phrase

1. Création : génération, affichage unique, vérification de quelques mots, puis la
   phrase est effacée de la mémoire. Seule la clé maîtresse est conservée.
2. Restauration : saisie des 24 mots → même clé maîtresse → connexion + déchiffrement.
3. Phrase perdue mais session active : export des données en clair, puis « recréer un
   compte » = nouvelle phrase, rechiffrement complet, migration, suppression de
   l'ancien compte.

### Supabase

- Auth par e-mail synthétique (`<identifiant>@…`) + mot de passe dérivé ; confirmation
  d'e-mail désactivée sur l'instance.
- Tables prévues : `profiles` (dont `storage_quota_bytes`, défaut 52 428 800),
  `items` (notes et catégories, blobs chiffrés, version, tombstone),
  `attachments` (métadonnées et taille), `shared_notes` (copie rechiffrée, lisible
  publiquement par identifiant).
- Bucket Storage privé pour les fichiers chiffrés.
- RLS : chaque utilisateur ne lit et n'écrit que ses lignes.
- Quota : vérifié côté serveur (trigger sur `attachments` + politique Storage), pièces
  jointes et images collées confondues.
- Instance modifiable dans l'app : URL **et** clé anon. Migrations SQL versionnées dans
  `supabase/migrations/` pour l'auto-hébergement.

### Mode hors ligne

La phrase et la clé sont créées dans tous les cas. La synchro est une option
activable ou désactivable ; sans elle, aucune requête réseau n'est émise.

### Partage par lien

- Forme : `https://<sous-domaine>/s/<id>#<clé>` — le fragment n'est jamais envoyé au
  serveur. Si l'instance Supabase est personnalisée, son adresse est aussi dans le
  fragment.
- La note est rechiffrée avec la clé de partage et déposée dans `shared_notes`.
- Révocation : suppression de la ligne.
- Lecture : dans l'app (lien universel) ou sur la page web statique en lecture seule.
- Page web : export web d'Expo limité à la route de lecture, CSP stricte, aucun script
  tiers, `Referrer-Policy: no-referrer`. Le même domaine sert aussi
  `apple-app-site-association` et `assetlinks.json`.

## 4. Phases

Chaque phase tient en principe en une session et se termine par un résultat vérifiable.

| # | Contenu | Terminé quand |
|---|---|---|
| 0 | Projet Expo (TypeScript, expo-router, dev build), lint et tests, thème clair/sombre/système, navigation, essai technique de la lib crypto et de l'éditeur | L'app démarre sur un appareil, le thème bascule, un aller-retour chiffrer/déchiffrer passe |
| 1 | Module crypto avec vecteurs de test, génération et affichage unique des 24 mots, restauration, stockage sécurisé, verrouillage biométrique | On peut créer puis restaurer un coffre |
| 2 | Base locale chiffrée, création/édition/suppression de notes, liste, recherche, catégories, archivage, corbeille | App utilisable hors ligne en texte simple |
| 3 | Éditeur riche, raccourcis Markdown, import/export `.md`, palette de couleurs adaptative | Mise en forme complète et persistante dans les deux thèmes |
| 4 | Schéma Supabase, RLS, authentification dérivée, moteur de synchro, choix de l'instance, bascule hors ligne | Deux appareils se synchronisent |
| 5 | Pièces jointes et images collées chiffrées par blocs, quota serveur, indicateur d'espace utilisé | Un envoi au-delà du quota est refusé par le serveur |
| 6 | Partage par lien, page de lecture web sur Cloudflare Pages, liens universels, révocation | Un lien s'ouvre sans compte, puis cesse de fonctionner après révocation |
| 7 | Export complet, recréation de compte, revue de sécurité, finitions | Le parcours « phrase perdue mais encore connecté » fonctionne |

### Suivi

- [x] Phase 0 — Fondations (voir « Bilan de la phase 0 »)
- [x] Phase 1 — Crypto et création du coffre (voir « Bilan de la phase 1 »)
- [ ] Phase 2 — Notes locales
- [ ] Phase 3 — Éditeur
- [ ] Phase 4 — Synchro Supabase
- [ ] Phase 5 — Pièces jointes et images
- [ ] Phase 6 — Partage par lien
- [ ] Phase 7 — Export, recréation de compte, finitions

### Bilan de la phase 0 (terminée le 2026-11-13, sur Android et web)

Fait et vérifié :
- Projet Expo SDK 58 (React Native 0.88, TypeScript, expo-router), écrans Notes,
  Réglages, `dev/crypto`, `dev/editor`.
- Thème clair / sombre / système, persistant ; palette de couleurs de notes par jetons.
- `src/crypto/aead.ts` : XChaCha20-Poly1305 + dérivation de sous-clés ; 9 tests Jest.
- `npm run typecheck`, `npm run lint`, `npm test` passent.
- **libsodium natif fonctionne sur Android** (émulateur `Pixel_10`, nouvelle
  architecture) : aller-retour, rejet d'une mauvaise clé, 1 Mo en 7 ms.
- **Compatibilité entre plateformes** : Android, web et Node dérivent la même sous-clé
  et déchiffrent le même message de référence (`src/crypto/vectors.ts`).
- **TenTap fonctionne sur Android** : titres, gras, italique, souligné, barré, listes,
  couleur de texte, surlignage, export JSON, thèmes clair et sombre.

Non vérifié :
- iOS n'a pas été compilé (pas de Mac).
- La barre d'outils TenTap au-dessus du clavier n'a pas été vue (clavier logiciel
  masqué sur l'émulateur).

Constats à retenir :
- La version native de `react-native-libsodium` n'accepte les données associées de
  l'AEAD que sous forme de **texte** (ni octets ni `null`) : l'API de `aead.ts` prend
  donc une chaîne. Elle n'expose **pas** non plus `secretstream` : en phase 5, les
  fichiers seront découpés en blocs chiffrés un par un (numéro de bloc dans les
  données associées).
- Sur le web, la dérivation de clés exige la variante « sumo » de libsodium
  (`loadSumoVersion()`, déjà appelé dans `aead.ts`).
- Dans la WebView de l'éditeur, les couleurs du thème se posent sur `body` : une
  règle CSS `*` écrase les couleurs de texte. Les couleurs sont pour l'instant
  stockées en hexadécimal par TenTap ; le passage aux jetons de palette est à faire
  en phase 3.
- Le type `theme` de TenTap dépasse la profondeur admise par TypeScript (contourné par
  un `as never` commenté dans `editor-spike.tsx`).
- `expo-doctor` signale `react-native-libsodium` comme « non testé sur la nouvelle
  architecture » : l'essai sur émulateur montre qu'il y fonctionne.
- npm 12 bloque les scripts d'installation : celui de `react-native-libsodium` est
  autorisé dans `package.json` (`allowScripts`).
- Identifiant d'app (Android et iOS) : `com.mandallazstudio.securenotes`.
- SQLCipher est déjà activé dans `app.json` pour éviter un nouveau build en phase 2.
- Sous Jest, `react-native-libsodium` est remplacé par `libsodium-wrappers-sumo`.
- Build Android local : `JAVA_HOME=~/android-studio/jbr ANDROID_HOME=~/Android/Sdk npx expo run:android`.
  Au premier lancement, le client de développement demande l'accès aux appareils à
  proximité (recherche du serveur de dev).

### Bilan de la phase 1 (terminée le 2026-11-13, sur Android et web)

Fait et vérifié sur l'émulateur Android :
- Création d'un coffre : 24 mots affichés une fois, vérification de 3 mots tirés au
  hasard, puis ouverture de l'app. La phrase n'est stockée nulle part.
- Persistance : après redémarrage de l'app, le coffre s'ouvre sans ressaisie.
- Suppression du coffre de l'appareil, puis restauration avec la phrase (tapée sans
  accents, avec majuscules) : on retrouve le même identifiant de compte.
- Captures et enregistrements d'écran bloqués sur l'affichage, la vérification et la
  saisie de la phrase (la capture sort noire).
- Copie de la phrase dans le presse-papiers, effacée après 60 secondes.
- Verrouillage biométrique (empreinte posée à la main sur l'émulateur) : activation,
  verrouillage manuel, refus après annulation, déverrouillage, et démarrage
  verrouillé après redémarrage de l'app.
- Messages d'erreur de restauration : nombre de mots, mots inconnus avec leur
  position, phrase incorrecte.
- 28 tests Jest (phrase, dérivation des clés, presse-papiers) ; types et lint passent.

Non vérifié :
- Verrouillage automatique après 30 s en arrière-plan (codé, non testé).
- iOS (pas de Mac), y compris l'expiration du presse-papiers gérée par le système.
- L'effacement du presse-papiers sur appareil n'est vérifié qu'indirectement (plus
  rien à coller après le délai) ; la logique est couverte par les tests Jest.

Décisions prises pendant la phase :
- **Liste de mots BIP39 française** (`@scure/bip39`). Elle n'a aucun doublon une fois
  les accents retirés : la saisie tolère accents manquants et majuscules.
- **Clé maîtresse = dérivation à sens unique de l'entropie** (`src/crypto/keys.ts`) :
  la clé stockée ne permet pas de retrouver la phrase. Sous-clés : identifiant de
  compte, secret d'authentification, clé d'enveloppe, clé de la base locale. Un test
  fige ces valeurs ; les contextes de dérivation ne doivent plus changer.
- **Biométrie liée au Keystore/Keychain** (`requireAuthentication` d'`expo-secure-store`)
  plutôt qu'un simple écran de verrouillage. Contrepartie : si les empreintes du
  téléphone changent, la clé est invalidée et il faut restaurer avec la phrase.
- Un marqueur non secret (identifiant de compte) dans les préférences indique qu'un
  coffre existe, sans déclencher de demande d'empreinte au démarrage.
- **Web** : la clé maîtresse ne vit qu'en mémoire et disparaît au rechargement.
- Presse-papiers (`src/security/secret-clipboard.ts`) : contenu marqué sensible sur
  Android, expiration système et copie locale uniquement sur iOS ; l'app n'efface que
  si le presse-papiers contient encore la phrase. Une phrase collée pour restaurer
  est effacée du presse-papiers aussitôt.

Constats à retenir :
- Sur Android, `autoCorrect={false}` ne suffit pas pour un champ multiligne : le
  clavier corrigeait « substrat » en « substrate ». Les champs de saisie de la phrase
  utilisent `keyboardType="visible-password"` (`src/components/text-field.tsx`).
- Les services d'accessibilité lisent toujours les mots affichés (c'est ainsi que les
  tests automatisés les ont relevés) : le blocage des captures ne couvre pas ce cas.
- Routes protégées par `Stack.Protected` selon l'état du coffre (`src/app/_layout.tsx`).
- Sur l'émulateur, `adb emu finger touch 1` est accepté mais n'est pas reconnu par la
  demande d'empreinte : il faut poser le doigt depuis les contrôles de l'émulateur.
- `@scure/bip39` est en ESM : Jest doit le transformer (`transformIgnorePatterns`).
- Le coffre laissé sur l'émulateur est un coffre d'essai dont la phrase figure dans
  les journaux de la session : à supprimer avant tout usage réel.

## 5. Points d'attention

- **Dev build obligatoire** dès la phase 0 : libsodium natif et SQLCipher ne
  fonctionnent pas dans Expo Go.
- **Versions des bibliothèques à vérifier en phase 0** (SDK Expo courant, TenTap,
  `react-native-libsodium`, option SQLCipher d'`expo-sqlite`) : rien n'a encore été
  testé.
- La phrase ne doit jamais être journalisée, ni placée dans un état persistant, ni
  capturable (bloquer les captures d'écran sur l'écran d'affichage si possible).
- La recherche se fait en local sur les données déchiffrées ; aucun index côté serveur.
- Le dossier n'est pas encore un dépôt git.

## 6. Pour reprendre

1. Lire ce fichier.
2. Repérer la première phase non cochée dans « Suivi ».
3. En fin de session : cocher la phase, noter ici les écarts par rapport au plan et
   toute nouvelle décision dans la section 2.
