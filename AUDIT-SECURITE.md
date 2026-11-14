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

## Restant

### Moyen

**1. Retour arrière et résurrection par le serveur.**
`synchronize` (`src/sync/engine.ts`) applique toute ligne qui se déchiffre et a
un `seq` plus grand. Une instance malveillante peut renvoyer un ancien chiffré
d'une note (retour à une ancienne version) ou d'une note supprimée depuis
(résurrection). Elle peut aussi retenir des éléments sans que ce soit détecté.
Confidentialité intacte, intégrité partielle.
*Piste :* refuser une version entrante plus ancienne (`updatedAt`) qu'une
version locale non modifiée ; garder les identifiants supprimés et refuser leur
réapparition. La détection des omissions demanderait un manifeste authentifié
(par exemple une chaîne d'empreintes sous la clé d'enveloppe).

**2. Contenu usurpé sous le domaine de lecture.**
`parseShareFragment` accepte n'importe quelle instance HTTPS dans le fragment.
N'importe qui peut fabriquer un lien `https://<site de lecture>/s/<id>#<clé>.<son instance>`
qui affiche son contenu avec le logo de l'app et la mention « le serveur ne
peut pas la lire » ; dans l'app aussi, via les liens d'app. Le lecteur ne peut
pas savoir qui a écrit la note.
*Piste :* afficher « Hébergé par *hôte* — contenu non vérifié » quand
l'instance n'est pas celle par défaut, ou limiter la page web à l'instance par
défaut et resserrer `connect-src`.

**3. Inscription ouverte sur l'instance.**
Avec la clé publique, un script peut créer un nombre illimité de comptes de
50 Mo chacun.
*Piste :* captcha à l'inscription (Turnstile ou hCaptcha, gérés par Supabase
Auth), limites de débit plus strictes, quota par défaut plus bas ou plafond
global, surveillance de l'usage.

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

**6. Détournement d'un lien pendant la recréation : réduit, pas supprimé.**
La fenêtre est désormais l'intervalle entre deux requêtes (plus long si l'app
est interrompue entre les deux). Un détournement est détecté et signalé, mais
le lien détourné ne peut pas être récupéré.
*Piste :* une fonction SQL qui transfère la ligne d'un compte à l'autre en une
seule transaction, sur preuve de possession des deux comptes.

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
