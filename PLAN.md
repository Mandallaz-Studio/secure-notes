# Secure Notes — plan de développement

> Document de reprise pour les prochaines sessions. Dernière mise à jour : 2026-11-14.
> État : **phases 0 à 5 terminées, phase 6 codée mais pas encore vérifiée de bout en bout**.
> Prochaine étape : finir la vérification de la phase 6 (voir son bilan), puis phase 7.
> À faire sur l'instance Supabase : appliquer `supabase/migrations/20261114000000_attachments.sql`
> puis `20261115000000_sharing.sql`.
> À fournir : le sous-domaine du site de lecture (`EXPO_PUBLIC_SHARE_BASE_URL` dans `.env.local`).

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
| Client Supabase | Appels HTTP directs (Auth + PostgREST), **sans `supabase-js`** | Trois requêtes suffisent ; moins de code tiers à auditer, aucune dépendance native, réutilisable tel quel sur la page de lecture web |
| Mot de passe du compte | Dérivé du secret d'authentification **et de l'adresse de l'instance** | Une instance malveillante n'apprend rien qui permette de se connecter ailleurs (et d'y supprimer les notes). Contrepartie : tous les appareils doivent saisir exactement la même adresse |
| Plateformes | iOS et Android | Voir ligne « App web complète » |
| Stockage des fichiers (phase 5) | Blocs chiffrés dans un **bucket Storage privé** (`attachments`), un objet par bloc ; la table `attachments` ne garde qu'une ligne par fichier | Demande de l'utilisateur (2026-11-14) : Storage offre plus de place que la base. Les politiques de Storage ne connaissant pas la taille d'un objet avant son dépôt, le quota est réservé à la déclaration du fichier (taille annoncée) et revérifié à chaque bloc sur la place réellement occupée |

| Copies partagées (phase 6) | Dans la table `shared_notes`, lues par la fonction `get_shared_note`, **pas dans Storage** | Un objet lisible sans compte serait soit dans un bucket public (mis en cache : révocation différée), soit énumérable par tous. La table n'est pas lisible publiquement, seule la lecture par identifiant l'est. Contrepartie : ces copies (4 Mo au plus chacune, images comprises) occupent la base ; elles comptent dans le quota |
| Contenu d'un partage (phase 6) | Copie figée au moment du partage, images incluses, **sans les fichiers joints** ; plusieurs liens possibles par note | Révoquer = supprimer la copie. Mettre la copie à jour demanderait de garder la clé du lien modifiable côté serveur |
| Web (phase 6) | Sur le web, l'app ne montre que la route de lecture `/s/<id>` ; export en mode « single » (une page, routage côté navigateur) | Les routes dynamiques ne se pré-rendent pas en statique ; Cloudflare Pages sert `index.html` pour tout chemin inconnu |

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
  `attachments` (clé chiffrée, nombre de blocs, taille), `shared_notes` (copie rechiffrée, lisible
  publiquement par identifiant).
- Bucket Storage privé pour les fichiers chiffrés.
- RLS : chaque utilisateur ne lit et n'écrit que ses lignes.
- Quota : vérifié côté serveur (déclencheur sur `attachments` + politique Storage),
  pièces jointes et images collées confondues.
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
- [x] Phase 2 — Notes locales
- [x] Phase 3 — Éditeur
- [x] Phase 4 — Synchro Supabase (voir « Bilan de la phase 4 »)
- [x] Phase 5 — Pièces jointes et images (voir « Bilan de la phase 5 »)
- [ ] Phase 6 — Partage par lien : codée, vérification de bout en bout en attente (voir « Bilan de la phase 6 »)
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

### Bilan de la phase 2 (terminée le 2026-11-13, sur Android et web)

Fait :
- `src/notes/` : types, modèle (fonctions pures), stockage mémoire, stockage SQLite
  chiffré SQLCipher (`sqlite-store.ts`, une base par compte, clé = `databaseKey`),
  gestionnaire d'ouverture/fermeture (`store-manager.ts`), contexte React.
- Écrans : liste (`src/app/index.tsx` : vues Notes / Archives / Corbeille, recherche,
  filtres par catégorie), note (`src/app/note/[id].tsx` : texte brut, enregistrement
  automatique, catégorie, archive, corbeille, restauration, suppression définitive),
  catégories (`src/app/categories.tsx`).
- Supprimer le coffre efface aussi la base de notes de l'appareil.
- 46 tests Jest ; types et lint passent.

Vérifié sur l'émulateur Android (stockage SQLite chiffré) et dans le navigateur
(stockage mémoire) : création, aperçu dans la liste, recherche, rangement dans une
catégorie, archivage et désarchivage, corbeille, restauration, suppression
définitive (annulation comprise), vidage de la corbeille, ajout de catégorie avec
refus des doublons, renommage, suppression (les notes restent, sans catégorie).

Vérifié sur l'émulateur seulement :
- Les notes survivent au redémarrage de l'app.
- Le fichier de base est illisible sans la clé : pas d'en-tête SQLite, aucun texte
  de note ni de catégorie en clair, `sqlite3` refuse de l'ouvrir.

Non vérifié :
- iOS (pas de Mac).
- La recherche avec accents sur l'émulateur (`adb` ne saisit pas les accents) ; elle
  est couverte par Jest et vérifiée dans le navigateur.
- Que supprimer le coffre efface bien le fichier de base sur l'appareil.
- Le verrouillage automatique après 30 secondes en arrière-plan (phase 1) : le
  coffre s'est bien verrouillé après une sortie de l'app, mais sans mesure du délai.

Constats à retenir :
- Android est bord à bord : la fenêtre ne se redimensionne pas pour le clavier.
  `KeyboardAvoidingView` doit avoir `behavior="padding"` sur les deux plateformes,
  avec `useHeaderHeight()` (de `expo-router/react-navigation`) comme décalage.
- Un `ScrollView` horizontal placé dans une colonne s'étire en hauteur : lui donner
  `flexGrow: 0`.
- `<Link asChild>` autour d'un `Pressable` dont le style est une fonction fait
  perdre ce style sur Android : utiliser `router.push` dans `onPress`.
- Les écrans sans en-tête passent sous la barre d'état : `Screen` a une option
  `withoutHeader` (écrans d'accueil et de verrouillage).
- Sur le web, `Button` et `Chip` reçoivent leur libellé comme nom accessible.
- Tests sur émulateur avec `adb` : la touche Retour sur la liste quitte l'app et
  verrouille le coffre ; l'invite d'empreinte doit être validée par l'utilisateur.

Choix faits :
- Les colonnes sont en clair à l'intérieur de la base chiffrée (recherche locale
  possible) ; le chiffrement note par note n'interviendra qu'à la synchro (phase 4).
- Une catégorie par note. Une note vide n'est pas conservée.
- Recherche insensible à la casse et aux accents via une colonne `search_text`.
- Sur le web, les notes ne vivent qu'en mémoire.

### Bilan de la phase 3 (terminée le 2026-11-13, sur Android)

Fait :
- `src/components/note-body.tsx` : corps de la note dans l'éditeur riche (TenTap),
  avec une barre d'outils maison au-dessus du clavier : annuler/rétablir, gras,
  italique, souligné, barré, code, titres 1 à 3, listes à puces, numérotées et de
  tâches, citation, 5 couleurs de texte, 4 surlignages. Variante web
  (`note-body.web.tsx`) : champ de texte brut.
- `src/notes/rich-text.ts` : couleurs stockées en jetons (`palette:red`), converties
  en teinte du thème à l'affichage ; texte brut extrait pour l'aperçu et la recherche.
- `src/notes/markdown.ts` : conversion document ↔ Markdown.
  `src/notes/markdown-files.ts` : export par la feuille de partage (bouton « Exporter »
  de la note), import par le sélecteur de fichiers (Réglages → Import).
- `src/notes/pending-notes.ts` : une note importée pendant que le coffre se verrouille
  attend en mémoire et est enregistrée au déverrouillage suivant.
- Une note en texte brut (phase 2) s'ouvre dans l'éditeur et passe au format `tiptap`
  à la première modification ; l'ouvrir sans la modifier ne la touche pas.
- 72 tests Jest (26 nouveaux) ; types et lint passent.

Vérifié sur l'émulateur Android :
- Raccourcis Markdown à la frappe : `# `, `**gras**`, `*italique*`, `~~barré~~`, `- `,
  `> `.
- Barre d'outils : souligné, titre 2, liste numérotée, liste de tâches, couleurs de
  texte, surlignage.
- La mise en forme survit à la fermeture de la note ; l'aperçu de la liste montre le
  texte.
- Thème : la même note prend les teintes sombres ou claires, y compris quand le thème
  change pendant qu'elle est ouverte.
- Export : la feuille de partage propose `<titre>.md`, au contenu correct.
- Import : titres, marques, listes imbriquées, liste de tâches, citation.
- Import pendant un verrouillage automatique (plus de 30 s dans le sélecteur) : la
  note est bien là après le déverrouillage. Cela confirme au passage le verrouillage
  automatique de la phase 1.

Non vérifié :
- iOS (pas de Mac).
- L'envoi réel du fichier exporté à une autre app (seule la feuille de partage a été
  vue) et la suppression différée du fichier temporaire.
- Italique, code, titres 1 et 3, citation depuis la barre d'outils (vus seulement via
  les raccourcis ou l'import), annuler/rétablir, liens.

Limites connues :
- Markdown : la couleur du texte est perdue à l'export ; le surlignage revient en
  jaune à l'import. L'éditeur n'a ni bloc de code ni ligne de séparation : un bloc de
  code importé devient un paragraphe en police de code, les séparations sont ignorées.
- Les frappes du dernier quart de seconde avant un retour arrière peuvent ne pas être
  enregistrées (le contenu est lu dans la WebView avec un léger délai). Archiver,
  Corbeille et Exporter lisent l'éditeur avant d'agir.
- Avec le clavier ouvert, la barre Archiver / Corbeille reste affichée et réduit la
  zone d'édition.
- L'export quitte le coffre **en clair** ; sa copie dans le cache de l'app est
  supprimée 2 minutes après le partage, au prochain export ou au prochain lancement.

Constats à retenir :
- Nouvelles dépendances natives : `expo-file-system`, `expo-sharing`,
  `expo-document-picker` (l'APK de développement a été reconstruit). `expo install` a
  ajouté le plugin `expo-sharing` dans `app.json`.
- npm 12 avale les options passées après `npx expo …` : lancer
  `./node_modules/.bin/expo run:android --no-bundler` et `npm run lint`.
- Fast Refresh ne suit plus après un passage de l'app en arrière-plan : recharger
  l'app (ce qui verrouille le coffre) pour être sûr de tester le code courant.
- Le bouton flottant des outils de développement recouvre le coin haut droit
  (« Réglages », « Exporter ») sur l'émulateur.
- Le navigateur n'est plus utilisé pour vérifier l'app (décision de l'utilisateur) :
  le web ne servira qu'à la page de lecture des liens partagés.

### Bilan de la phase 4 (terminée le 2026-11-13, sur deux émulateurs Android)

Fait :
- `supabase/migrations/20261113000000_sync.sql` : tables `profiles` (quota, pour la
  phase 5) et `items`, RLS par compte, pas de suppression de ligne, numéro de
  modification `seq` attribué par un déclencheur. Réglage requis sur l'instance : « Confirm email » désactivé.
- `src/sync/codec.ts` : chaque envoi tire une clé aléatoire, chiffrée par la clé
  d'enveloppe ; l'identifiant de l'élément est authentifié avec le blob. Le serveur
  ne distingue pas une note d'une catégorie, ni une modification d'une suppression.
- Une suppression définitive est un message chiffré comme un autre : un appareil
  ne supprime que si le message se déchiffre avec la clé du compte. Qui contrôle le
  serveur ne peut donc pas faire supprimer des notes (ligne vidée, suppression
  d'une autre note rejouée, autre clé : ignorées, couvert par Jest).
- `src/sync/engine.ts` : téléchargement de ce qui suit le dernier `seq` vu, puis
  envoi des éléments modifiés en précisant la version remplacée (refus du serveur si
  elle est dépassée, et on recommence).
- `src/sync/supabase.ts` : connexion, création du compte au premier usage, lecture
  et écriture de `items`. Adresse `<identifiant>@securenotes.invalid`.
- `src/sync/sync-context.tsx` : synchro à l'ouverture du coffre, 2 s après une
  écriture locale, au retour au premier plan et toutes les 30 s.
- Réglages → Synchronisation : adresse et clé de l'instance, activation (rien n'est
  enregistré tant que l'instance n'a pas accepté la connexion), désactivation,
  « Synchroniser maintenant », état. Désactivée par défaut.
- Base locale en version 2 : colonnes `dirty` et `server_seq`, tables `tombstones`
  et `sync_state`. Changer d'instance remet l'état de synchro à zéro et renvoie tout.
- Une note ouverte est rechargée si elle change sur un autre appareil, sauf si des
  modifications locales attendent d'être enregistrées.
- 95 tests Jest (23 nouveaux) ; types et lint passent.

Vérifié sur `Pixel_10` et `Small_Tablet`, même coffre, instance Supabase hébergée
(clé « publishable ») :
- Activation : compte créé sur le premier appareil, connexion sur le second.
- Une note créée sur l'un apparaît sur l'autre, dans les deux sens.
- Même note modifiée hors ligne (mode avion) des deux côtés : la plus récente
  l'emporte, l'autre est gardée en « (copie de conflit) », sur les deux appareils.
- Mise à la corbeille puis suppression définitive : propagées.
- Sans session, l'API refuse la lecture de `items` et de `profiles`.

Non vérifié :
- iOS (pas de Mac).
- Le contenu des lignes côté serveur n'a pas été relu (pas d'accès au tableau de
  bord) ; le chiffrement est couvert par Jest.
- La mise à niveau d'une base contenant déjà des notes de la phase 3 (l'app n'était
  plus installée sur l'émulateur : seule une base neuve a été migrée).
- Les suppressions chiffrées sur appareil : la vérification sur émulateurs a été
  faite avec la première forme (marqueur `deleted` en clair), remplacée ensuite.
- Catégories entre appareils, changement d'instance, désactivation, expiration de
  session (1 h), plus de 200 éléments : couverts par Jest seulement.
- Qu'aucune requête n'est émise tant que la synchro est désactivée (non mesuré).

Règles de conflit :
- Note modifiée des deux côtés : la date de modification la plus récente l'emporte,
  l'autre version devient une nouvelle note. Catégories : la plus récente, sans copie.
- Une modification l'emporte toujours sur une suppression définitive.
- Deux modifications identiques ne créent pas de copie.

Limites connues :
- Une version distante reçue pendant la fraction de seconde où une frappe attend
  d'être enregistrée dans la même note est écrasée sans copie.
- Les dates comparées sont celles des appareils : une horloge fausse fausse le choix
  du gagnant (l'autre version reste dans la copie).
- Le serveur n'authentifie que la session, pas le contenu : c'est l'appareil qui
  vérifie, au déchiffrement. Le serveur peut encore resservir une ancienne version
  d'un élément (y compris une ancienne suppression d'une note recréée depuis) ou
  retenir des mises à jour, sans être détecté.
- Les lignes supprimées restent sur le serveur, sous forme de petit blob chiffré.
- Pas de temps réel : jusqu'à 30 s de délai entre deux appareils.

Constats à retenir :
- Aucune dépendance native ajoutée : l'APK de développement de la phase 3 a servi
  tel quel. S'il faut reconstruire, ne viser que l'architecture utile :
  `-PreactNativeArchitectures=x86_64` pour l'émulateur.
- `.env.local` (non versionné) : `EXPO_PUBLIC_SUPABASE_URL` et
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` préremplissent les champs ; relancer Metro après
  modification.
- Supabase hébergé accepte les adresses en `.invalid` et la clé `sb_publishable_…`.
- Le bouton flottant des outils de développement recouvre « Réglages » : ouvrir
  l'écran par `adb shell am start -a android.intent.action.VIEW -d securenotes://settings`.
- `adb shell cmd connectivity airplane-mode enable|disable` pour simuler le hors-ligne.
- L'instance d'essai a été créée avec la première forme de la migration : elle garde
  une colonne `deleted` inutilisée (`alter table public.items drop constraint
  items_tombstone, drop column deleted;` pour l'aligner).
- Les deux émulateurs portent un coffre d'essai dont la phrase figure dans les
  journaux de la session ; son compte existe sur l'instance Supabase.

### Hors phase : import de fichiers texte (2026-11-13)

`src/notes/text-import.ts` : tout fichier texte s'importe (Réglages → Import). Markdown
converti, RTF réduit à son texte, le reste (`.txt`, `.csv`, `.json`, code…) en texte
brut. UTF-8, UTF-16 avec marque d'ordre, sinon Windows-1252. Binaire ou plus de 2 Mo :
refusé. Vérifié sur l'émulateur (`.txt` Latin-1, `.rtf`, `.csv`, refus d'un JPEG).

### Bilan de la phase 5 (terminée le 2026-11-14, sur un émulateur Android)

Fait :
- **Blobs** (`src/notes/blobs.ts`) : le contenu d'une image ou d'un fichier joint est
  stocké à part de la note, dans la base SQLCipher (table `blobs`, base en version 3).
  La note n'en garde que l'identifiant : `src: "sn-blob:<id>"` dans le document pour une
  image, champ `attachments` (nom, type, taille) pour un fichier. Un blob ne change jamais.
- **Images** : bouton 🖼 de la barre d'outils. Image réduite à 1600 px, recompressée en
  JPEG (métadonnées retirées). L'éditeur l'affiche en adresse `data:` ; à
  l'enregistrement elle devient un blob. Les images `data:` restées dans d'anciennes
  notes ou venues d'un import Markdown sont converties de la même façon à la première
  modification. Une adresse distante est retirée (aucune requête ne sort de l'app).
- **Fichiers joints** (écran de la note) : « ＋ Joindre un fichier » (20 Mo au plus),
  ouverture par la feuille de partage, retrait avec confirmation.
- **Chiffrement par blocs** (`src/crypto/chunks.ts`) : clé aléatoire par fichier,
  chiffrée par la clé d'enveloppe ; blocs de 256 Kio ; chaque bloc authentifie
  l'identifiant du fichier, son rang et le nombre total de blocs.
- **Serveur** (`supabase/migrations/20261114000000_attachments.sql`) : table
  `attachments` (une ligne par fichier) et bucket Storage privé `attachments`, où
  chaque bloc chiffré est l'objet `<compte>/<fichier>/<rang>`, envoyé en binaire.
  RLS par compte sur la table et sur le bucket ; un bloc déposé ne se remplace pas.
  Quota : la taille annoncée est réservée à la déclaration du fichier
  (`profiles.storage_used_bytes`, refus `storage_quota_exceeded`), et chaque dépôt de
  bloc est refusé si la place réellement occupée dans le bucket atteint le quota (un
  client modifié ne dépasse donc que d'un bloc au plus).
- **Synchro** (`src/sync/blobs.ts`), après celle des notes : envoi des blobs référencés,
  téléchargement de ceux qui manquent, reprise d'un envoi interrompu, suppression (ici
  et sur le serveur) d'un blob que plus aucune note ne référence depuis 10 minutes.
  Un échec côté fichiers ne bloque pas la synchro des notes.
- **Réglages → Stockage** : place occupée sur l'appareil ; avec la synchro, jauge
  « utilisé sur quota » et message si le serveur a refusé des fichiers.
- 134 tests Jest (23 nouveaux) ; types et lint passent.

Vérifié sur `Pixel_10` : mise à niveau d'une base de la veille (version 2 → 3, notes
conservées), affichage d'une ancienne image `data:` puis sa conversion en blob à la
première frappe, réouverture (image relue depuis son blob), ajout d'un fichier joint,
ouverture (contenu exact dans la feuille de partage), indicateur de stockage.

Non vérifié :
- **Tout le côté serveur** : la migration n'a été ni appliquée ni exécutée (pas d'accès
  au tableau de bord, pas de Postgres local). Le refus au-delà du quota, la reprise et
  le ménage ne sont couverts que par Jest, contre un serveur simulé. En particulier,
  les formes exactes des réponses de Storage (doublon, refus RLS, objet absent) et le
  droit de poser des politiques sur `storage.objects` depuis une migration sont à
  confirmer sur l'instance.
- La synchro d'images et de fichiers entre deux appareils.
- iOS ; un fichier joint de plusieurs Mo ; une vraie photo d'appareil.

Limites connues :
- Pas de collage d'image depuis le presse-papiers (bouton seulement).
- Une image arrivée par synchro pendant que sa note est ouverte n'apparaît qu'à la
  réouverture (image d'attente entre-temps).
- Un appareil ne supprime du serveur que les blobs qu'il connaît : un blob dont le seul
  appareil détenteur est effacé avant le ménage reste sur le serveur et occupe le quota.
- Les notes elles-mêmes ne comptent pas dans le quota.
- Supprimer un compte côté serveur laisse ses objets dans le bucket (à vider à la main).
- Un fichier ouvert quitte le coffre **en clair** (copie supprimée après 2 minutes).

### Bilan de la phase 6 (codée le 2026-11-14, vérification incomplète)

Fait :
- **Serveur** (`supabase/migrations/20261115000000_sharing.sql`) : table `shared_notes`
  (copie chiffrée, méta chiffrée, taille comptée dans le quota), RLS par compte, et
  fonction `get_shared_note(share_id)` ouverte à tous : c'est la seule lecture publique,
  la table ne peut pas être parcourue.
- **Format** (`src/share/codec.ts`) : lien `<site>/s/<id>#<clé>` ; la clé (256 bits,
  aléatoire, propre au lien) n'est que dans le fragment. Si l'instance n'est pas celle
  de la compilation, son adresse et sa clé publique suivent : `#<clé>.<instance>`.
  La copie authentifie l'identifiant du lien. Le propriétaire garde, chiffrés par la clé
  d'enveloppe, la note d'origine, la clé du lien et le début du titre : tout appareil du
  compte peut ainsi relister, recopier et révoquer les liens.
- **App** : bouton « Partager » dans l'en-tête d'une note → écran `/share/<note>`
  (créer un lien, copier, envoyer par la feuille de partage, révoquer). Réglages →
  Partage → « Liens de partage » : tous les liens du compte, y compris ceux de notes
  supprimées. Le partage exige la synchronisation activée.
- **Lecture** (`src/app/s/[id].tsx`, `src/components/rich-view.tsx`) : affichage en
  lecture seule sans WebView (titres, marques, couleurs par jetons selon le thème,
  listes, tâches, citations, images incluses). Une image distante n'est jamais chargée,
  un lien ne s'ouvre que s'il est en http(s). La route est accessible coffre verrouillé
  ou absent ; sur le web c'est la seule.
- **Site** : `npx expo export -p web` produit le site statique (dossier `dist`) ;
  `public/_headers` pose la CSP (aucun script tiers, `wasm-unsafe-eval` pour libsodium),
  `Referrer-Policy: no-referrer`, pas de mise en cache de la page.
- **Liens d'app** (`app.config.js`) : si `EXPO_PUBLIC_SHARE_BASE_URL` est définie, l'app
  déclare le filtre d'intention Android (`https://<site>/s/…`, `autoVerify`) et le
  domaine associé iOS. Sans elle, les liens sont en `securenotes://s/…`.
- 144 tests Jest (10 nouveaux) ; types et lint passent.

Vérifié, dans un navigateur, sur l'export web servi en local avec la CSP du fichier
`_headers` :
- la page se charge sans erreur de CSP, libsodium compris ; `/` renvoie sur la lecture ;
- lien tronqué → message « incomplet ou invalide » ; instance sans la migration →
  message d'erreur du serveur ;
- avec une réponse du serveur simulée dans la page : une copie chiffrée par le même
  algorithme se déchiffre et s'affiche (titre, gras, couleur, surlignage, listes, tâches,
  citation, image incluse) ; l'image distante du document n'est pas chargée ; une seule
  requête sort, vers `get_shared_note`.

Déploiement (14/11/2026) : migrations appliquées ; site sur Cloudflare Pages relié au
dépôt GitHub (build à chaque push sur `main` : `npx expo export -p web`, dossier `dist`,
variables `EXPO_PUBLIC_SUPABASE_*` et `NODE_VERSION`) ; sous-domaine
`https://notes.mandallaz.fr` (CNAME OVH → `secure-notes-c80.pages.dev`), dans
`.env.local` comme `EXPO_PUBLIC_SHARE_BASE_URL`.

**Critère de la phase vérifié** sur émulateur (Pixel_10) avec un coffre de test neuf :
synchro activée, note créée, « Partager » → « Créer un lien » donne
`https://notes.mandallaz.fr/s/<id>#<clé>` ; ouvert dans un navigateur sans compte, la
note se déchiffre et s'affiche ; après « Révoquer », le même lien rechargé affiche « Ce
lien n'existe plus ».

Non vérifié :
- L'ouverture d'un lien `https://…/s/…` directement dans l'app.
- La liste Réglages → Partage → « Liens de partage ».

Reste à faire :
- Liens d'app : ajouter `public/.well-known/assetlinks.json` (empreinte SHA-256 du
  certificat de signature : `eas credentials -p android`) et
  `public/.well-known/apple-app-site-association` (identifiant d'équipe Apple), puis
  reconstruire l'app (le filtre d'intention est natif).
- `public/_headers` : la règle `/*` (`no-store`) s'ajoute à celle de `/_expo/*`, si bien
  que les scripts ne sont jamais mis en cache.

Limites connues :
- Supprimer une note ne révoque pas ses liens (ils restent listés dans les réglages).
- La copie ne suit pas les modifications de la note : il faut recréer un lien.
- Qui a eu le lien a pu garder la copie : révoquer n'efface que celle du serveur.
- Le serveur voit quand et combien de fois une copie est lue, et depuis quelle adresse.
- La clé reste dans l'historique du navigateur du destinataire (fragment de l'adresse).
- Un lien ouvert dans l'app émet une requête vers l'instance qu'il désigne, même
  synchronisation désactivée.

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
