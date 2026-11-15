# Audit de sécurité — suivi

> Audit du 2026-11-14 (chiffrement de bout en bout, synchro Supabase, partage,
> stockage local, configuration, dépendances). Ce document liste ce qui a été
> corrigé à la suite de l'audit et ce qui reste ouvert.

## Verdict d'ensemble

Aucune faille critique ni élevée. Le cœur cryptographique est sain :
XChaCha20-Poly1305 avec nonces aléatoires de 192 bits, sous-clés BLAKE2b par
usage, phrase BIP39 de 256 bits, identifiants authentifiés dans les données
associées, clé maîtresse dans le Keychain / Keystore (liée à la biométrie par le
système quand elle est activée), SQLCipher, RLS correcte côté Supabase.

## Corrigé

| # | Constat | Correctif |
|---|---|---|
| 3 | Détournement d'un lien de partage pendant « Recréer le coffre » | Chaque lien est transféré seul (suppression par l'ancien compte puis recréation aussitôt), **avant** la fermeture de l'ancien compte. Un 409 n'est plus pris pour un succès : `createShare` vérifie que la ligne existante est bien la sienne, sinon `ShareTakenError`. Les liens détournés sont signalés dans les réglages (`sharesTaken`). |
| 4 | Aucune protection en cas d'accès physique au téléphone sans biométrie | Option **Verrouillage par code** (code, schéma, empreinte ou visage de l'appareil), désactivée par défaut, au démarrage et après 30 s en arrière-plan. Option **Masquer dans les apps récentes** (Android : `FLAG_SECURE` ; iOS : captures bloquées et voile flouté dans le sélecteur d'apps), désactivée par défaut. |
| 6 | Les tailles des données chiffrées trahissaient le type d'élément (suppression, catégorie, note) et la longueur exacte des notes | Bourrage du texte clair avant chiffrement (`src/crypto/padding.ts`) : au moins 1 Kio, puis paliers Padmé (≤ 12 % de surcoût). Appliqué aux éléments synchronisés, aux copies partagées et à leurs métadonnées. Les espaces ajoutés sont ignorés par `JSON.parse` : le format ne change pas, les anciennes versions lisent les nouveaux messages. |
| 7 | Rien ne vérifiait que SQLCipher était présent | `PRAGMA cipher_version` à l'ouverture : la base est refusée si SQLCipher manque au build. |
| 8 | La WebView de l'éditeur pouvait naviguer vers une page distante (qui aurait reçu le canal de messages vers l'app) | Garde de navigation (`src/components/editor-navigation.ts`) : seule la page de l'éditeur est admise, un lien http(s) s'ouvre dans le navigateur, tout autre schéma est refusé, aucune nouvelle fenêtre. |
| 9 | Le lien de partage (qui contient la clé) était copié dans un presse-papiers ordinaire | `copySensitive` : marqué sensible sur Android (ni aperçu, ni historique du clavier), local à l'appareil sur iOS. |
| 10 | Une erreur passagère du Keystore faisait passer le coffre pour vide, avec un risque d'effacement de la clé | Une erreur de lecture mène désormais à l'écran de verrouillage (« Clé momentanément illisible », bouton Réessayer). Seule une clé réellement absente mène à l'accueil. |
| 11 | Pas de HSTS ; un serveur hostile pouvait envoyer une réponse ou un document démesurés | `Strict-Transport-Security` dans `public/_headers`. `fetchSharedNote` refuse une réponse de plus de 8 Mo (annoncée par `Content-Length` ou constatée). Un document partagé de plus de 64 niveaux d'imbrication ou de 200 000 nœuds est refusé avant affichage. |

Vérifications : 187 tests Jest (dont de nouveaux tests pour le bourrage, les
bornes du document, le 409 détourné, la reprise du transfert des liens, la copie
sensible et les réponses démesurées), `tsc` et `expo lint` sans erreur. Sur
l'émulateur Android : ouverture de la base avec la vérification de SQLCipher,
synchronisation avec bourrage, éditeur avec la garde de navigation, et
`FLAG_SECURE` posé, retiré et rétabli au redémarrage.

**Non vérifié sur appareil :** le verrouillage par code (l'émulateur n'a pas de
verrouillage d'écran ; la ligne apparaît bien « Indisponible ») et le voile du
sélecteur d'apps sur iOS.

**À déployer :** l'en-tête HSTS et les nouvelles bornes de la page de lecture
ne s'appliquent qu'après un nouvel export web publié sur Cloudflare Pages.

### Second passage (audits externes du 2026-11-14 : SN-01 à SN-05, SN-AUD-001 à 003)

| Réf. | Constat | Correctif |
|---|---|---|
| SN-01 | Un lien révoqué (ou dont la note est mise à la corbeille) libérait son identifiant : n'importe quel destinataire pouvait y déposer une fausse note, affichée comme authentique | Migration `20261117000000_share_tombstones.sql` : toute suppression d'un partage note son identifiant dans `revoked_shares`, et un partage ne peut plus être créé sous un identifiant noté (`share_id_revoked`). « Recréer le coffre » ne supprime plus les liens pour les recréer : `transfer_share()` change leur propriétaire en une seule transaction, avec l'accord préalable du nouveau compte (`accept_shares_from`). Supprime aussi la fenêtre de détournement de l'ancien point 6. |
| SN-02 / SN-AUD-001 | Une instance malveillante pouvait ramener une note à une ancienne version, ou faire réapparaître une note supprimée | La date de modification d'une note ou catégorie ne recule plus jamais (`touched`, `src/notes/model.ts`), même avec une horloge en retard. Chaque base garde la plus récente version échangée avec le serveur pour chaque élément, même supprimé (table `version_floor`, migration locale 6). Une ligne qui n'est pas plus récente est écartée et la version de l'appareil (ou sa suppression) renvoyée ; une suppression porte désormais la date de la version qu'elle supprime, et une suppression plus ancienne que la version locale est écartée. Le nombre de versions écartées s'affiche dans les réglages. |
| SN-03 / SN-AUD-002 | Un lien pouvait désigner n'importe quelle instance et s'afficher sous le nom et le logo de l'app | La page de lecture (web et app) annonce une instance autre que celle de l'app **avant** de la contacter (« Serveur inconnu »), puis affiche « Hébergée sur *hôte* » et retire le logo et la mention « le serveur ne peut pas la lire ». Dans l'app, ouvrir un lien demande aussi confirmation quand l'instance n'est pas celle où l'on synchronise (ou sans synchronisation) : aucune requête sans accord. |
| SN-05 | Activer ou couper la biométrie supprimait la clé avant d'écrire la nouvelle : une demande d'empreinte annulée ou une app tuée entre les deux perdait la clé | Deux emplacements dans le Keychain / Keystore (`src/vault/key-store.ts`) : la nouvelle entrée est écrite dans l'emplacement libre, puis l'emplacement actif bascule. Un échec laisse l'ancienne entrée intacte. Une clé absente alors que le coffre est connu ne mène plus à l'accueil : l'écran de verrouillage propose « Restaurer avec la phrase », sans effacer la base de l'appareil. |

Vérifications : 203 tests Jest (nouveaux : enregistrement de la clé avec un
Keystore qui refuse, transfert des liens, identifiant révoqué, versions
resservies par le serveur, horloge en retard), `tsc` et `expo lint` sans
erreur. Les nouvelles requêtes SQLite (migration 6, plancher de version) ont été
exécutées sur un moteur SQLite 3.46.

**Non vérifié :** la migration Supabase n'a pas été exécutée sur une base
PostgreSQL ; rien n'a été essayé sur l'émulateur.

**À déployer :** appliquer la migration `20261117000000_share_tombstones.sql`
**avant** de publier l'app (l'ancien transfert des liens par suppression puis
recréation échoue avec elle, le nouveau a besoin d'elle) ; publier un nouvel
export web pour la page de lecture.

### Nouvelle fonction : envoi d'un lien par QR code (2026-11-15)

Un navigateur (extension `extension/`) ou une autre app affiche un QR code
(« Recevoir une note ») ; le téléphone le scanne depuis l'écran de partage
d'une note et y envoie un lien existant. Protocole : `src/share/handoff.ts`.

| Point | Choix |
|---|---|
| Contenu du QR code | Secret de 256 bits + clé publique X25519 éphémère de l'afficheur (`SN1R:…`, pas une adresse : aucune app ne l'ouvre seule). Ni l'un ni l'autre ne passe par le serveur : il ne peut pas substituer sa propre clé. |
| Chiffrement | Deux couches. XChaCha20-Poly1305 sous une clé dérivée du secret (BLAKE2b), données associées = canal et clé publique ; puis `crypto_box_seal` vers la clé publique. La couche symétrique authentifie l'expéditeur et résiste à un ordinateur quantique (le secret ne transite jamais) ; la couche asymétrique protège de qui n'aurait que photographié le QR code. Premier usage de cryptographie asymétrique dans l'app, **en plus** du symétrique, jamais à sa place. |
| Bourrage | Message bourré à 1 Kio au moins : la présence d'une instance dans le lien ne se voit pas à la taille. |
| Serveur | Table `handoffs` (migration `20261118000000_handoffs.sql`). Dépôt par un compte connecté seulement (celui qui partage, synchro active), compte ouvert, une fois par identifiant (premier arrivé), 20 dépôts en attente au plus, 4 096 caractères au plus. Relève publique par identifiant (`take_handoff`), qui supprime la ligne ; rien n'est servi après 5 minutes. **Aucune écriture anonyme nouvelle.** |
| Identifiant de canal | Empreinte du secret : impossible à deviner sans avoir vu le QR code, et ne révèle pas le secret. |
| Réception | Le lien reçu est validé (identifiant UUID, clé de 256 bits, instance en https), puis reconstruit sur le site de lecture fixé à la compilation (extension) ou ouvert par `/s/<id>` avec ses avertissements habituels (app). Aucune adresse reçue n'est ouverte telle quelle. |
| Secrets en mémoire | Effacés à la réception, à l'expiration, à la fermeture de la fenêtre ou de l'écran. Écran « Recevoir » protégé des captures. Le lien à envoyer passe de l'écran de partage à l'écran de scan en mémoire seulement, pas dans les paramètres de navigation. |
| App | Appareil photo demandé à l'usage (scan seulement), aucune image gardée. `RECORD_AUDIO` retiré du manifeste (`blockedPermissions`), pas de clé micro sur iOS. Sans synchronisation, « Recevoir » demande avant de contacter le serveur. |
| Extension | Permission `storage` seulement, aucune permission d'hôte ni script de contenu, CSP `default-src 'none'`. |

Vérifié : 15 tests Jest (aller-retour, autre QR code, message altéré, message
scellé sans le secret, secrets effacés, liens invalides refusés, bourrage,
relève et dépôt HTTP) ; la fenêtre de l'extension dans un navigateur
(Chromium), avec un serveur simulé : relève, réception d'un message scellé
par le code du téléphone, ouverture du bon lien, refus d'un message forgé.

Vérifié aussi sur l'instance de production (migration appliquée le
2026-11-15) : avec la clé publique, `take_handoff` répond `null`, et
l'écriture comme la lecture directes de `handoffs` sont refusées (42501).
De bout en bout sur l'émulateur Android : l'appareil photo a lu le QR code
d'un récepteur (même code que l'extension, exécuté sous Node), l'app a
déposé le lien, le récepteur l'a relevé (une seconde relève répond `null`),
l'a ouvert, puis a déchiffré la note partagée avec la clé reçue.

**Non vérifié :** le paquet de l'extension n'a été chargé ni dans Chrome ni
dans Firefox (CSP et manifeste non éprouvés) ; la réception par une autre
app avec un vrai dépôt (l'écran affiche le code et relève, mais rien n'y a
été envoyé).

**Risques résiduels :**
- Qui photographie le QR code peut, avant le téléphone, déposer un faux lien
  (il lui faut un compte sur l'instance, ouverte à l'inscription) : le
  navigateur ouvrirait alors une note de son choix, sur le vrai site de
  lecture. Même risque que l'auteur non authentifié d'un lien (point 2). Il
  peut aussi relever le message avant l'afficheur, sans pouvoir le lire.
- Une page web peut imiter la fenêtre de l'extension et son QR code : le
  téléphone enverrait alors le lien à cette page. Seul l'utilisateur sait
  quel écran il scanne (rappel affiché sur l'écran de scan).
- Le serveur voit qu'un compte a envoyé un lien, quand, et l'adresse IP du
  navigateur qui le relève.

## Restant

### Moyen

**1. Rétention d'éléments par le serveur (reste de SN-02).**
Le retour arrière et la résurrection sont écartés, mais une instance peut
encore retenir des éléments (ne jamais servir une modification à un autre
appareil) sans que ce soit détecté. Les versions envoyées par une ancienne
version de l'app, dont l'horloge retarde, peuvent aussi être écartées à tort.
*Piste :* manifeste authentifié du compte (chaîne d'empreintes des couples
(id, version) sous une clé dérivée), vérifié par chaque appareil.

**2. Auteur d'un lien non authentifié (reste de SN-01 et SN-03).**
Les liens ne peuvent plus être repris, et les instances inconnues sont
annoncées, mais un lien prouve seulement que son contenu vient de qui
connaît la clé. Les identifiants révoqués avant la migration restent
réutilisables.
*Piste :* signature Ed25519 par partage (clé publique dans le fragment).

**3. Inscription ouverte sur l'instance.**
Avec la clé publique, un script peut créer un nombre illimité de comptes de
50 Mo chacun.
*Piste :* captcha à l'inscription (Turnstile ou hCaptcha, gérés par Supabase
Auth), limites de débit plus strictes, quota par défaut plus bas ou plafond
global, surveillance de l'usage.
*Réglages retenus (tableau de bord Supabase, sans changement de code) :*
- **Authentication → Rate Limits** : baisser « Sign-ups and sign-ins » (30
  requêtes / 5 min par IP par défaut ; l'app n'appelle `/auth/v1/signup`
  qu'une fois par coffre et par instance), par exemple à 10.
- **Organization → Billing** : plafond de dépenses (spend cap) et alertes
  d'usage sur la base, le stockage et le trafic sortant.
- **Authentication → Sign In / Providers** : « Confirm email » reste désactivé
  (l'app l'exige).
- **Ne pas activer** la protection CAPTCHA (Authentication → Bot and Abuse
  Protection) tant que l'app n'envoie pas de jeton : elle couvrirait aussi la
  connexion, et bloquerait alors tous les appareils.
- Non couvert par le tableau de bord : quota par défaut plus bas (migration
  SQL), limite de débit sur `get_shared_note` (fonction edge ou proxy).

### Faible

**4. Le verrouillage par code est une barrière de l'app, pas du système.**
Contrairement à la biométrie, la clé n'est pas liée au code par le Keystore
(`expo-secure-store` n'accepte que la biométrie forte). Sur un appareil rooté ou
par analyse forensique, la clé reste lisible sans le code. Sans aucune option
de verrouillage activée (choix par défaut), un téléphone déverrouillé donne
toujours accès aux notes.

**5. Bourrage incomplet.**
Les fichiers joints et les images ne sont pas bourrés : le serveur voit leur
nombre de blocs et leur taille. Bourrer leur dernier bloc changerait le format
des fichiers (les anciennes versions liraient des octets en trop). Restent
visibles aussi : nombre d'éléments, heures de modification, et l'activité de
tous les comptes à travers la séquence globale `items_seq`. Le bourrage
augmente l'occupation du quota (au moins ~1,4 Kio par note ou catégorie).

**6. ~~Détournement d'un lien pendant la recréation~~** — corrigé par
`transfer_share()` (voir SN-01).

**7. Bornes des réponses partielles.**
Une réponse sans `Content-Length` est lue entièrement avant le contrôle de
taille. Le téléchargement des éléments (`pull`, jusqu'à 200 lignes de 4 Mo) n'est
pas borné, mais il vient de l'instance de l'utilisateur.

**8. Lien trompeur dans une note partagée.**
Le texte d'un lien peut différer de son adresse (`RichView` ouvre l'adresse
réelle, en http(s) seulement). Piste : afficher le domaine avant d'ouvrir.

**9. Biométrie : refus et invalidation se confondent.**
Le système ne distingue pas une empreinte refusée d'une clé invalidée par un
changement d'empreintes ; l'écran de verrouillage montre le même message.

### Information

- Les écrans `dev/crypto` et `dev/editor` sont cachés des réglages en
  production, mais restent accessibles par lien profond
  (`securenotes://dev/crypto`) quand le coffre est ouvert.
- Le dossier privé se referme au passage en arrière-plan, pas à l'état
  `inactive` (sélecteur d'apps sur iOS) ; il masque ses notes sans les chiffrer
  à part (documenté).
- Pendant le retrait d'un ancien coffre, sa clé maîtresse reste dans le
  Keychain / Keystore sans biométrie (choix documenté).
- L'identifiant de compte n'est pas lié à l'instance : deux instances peuvent
  reconnaître le même utilisateur (le mot de passe, lui, est lié).
- Quota : des envois de blocs en parallèle peuvent le dépasser de quelques blocs ;
  supprimer une ligne `attachments` sans ses blocs laisse des objets orphelins
  (qui continuent de compter dans le contrôle des blocs).
- `npm audit` : 3 alertes moyennes (`minimatch`, via `@expo/fingerprint`), outils
  de build uniquement.
