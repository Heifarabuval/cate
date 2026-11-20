# Feature Specification: Panneaux perso, écarts du jalon 1 puis partage

**Feature Branch**: `docs/spec-panneaux-perso-partage`

**Created**: 2026-11-20

**Issue**: Heifarabuval/cate#101 (les écarts du jalon 1). Le partage n'a pas encore d'issue : à ouvrir à la validation de cette spec.

**Status**: Draft. Spec d'abord, aucun code. Les questions ouvertes sont en fin de document, chacune avec une hypothèse de travail.

**Input**: le type de panneau `app` charge déjà des dossiers de `~/.cate/panneaux/<id>/` (manifeste `cate-panel.json`, page HTML, carte d'accord, CSP). Deux parties : (1) corriger les écarts du jalon 1 listés dans #101 ; (2) laisser chaque dev partager ses panneaux (exporter, importer un dossier), sur le modèle des noeuds n8n : intégrés, perso locaux, installables. Le plus petit mécanisme qui tient, sans registre communautaire.

Liens :
- Spec Skills `008-panneaux-perso` (dépôt Skills, lecture seule) : D8 (modèle de risque), D11 (partage), FR-006, FR-012, FR-014, FR-016, FR-017, US6, Q1 à Q3. Cette spec reprend ses décisions et ne les rouvre pas. Écart de vocabulaire : 008 dit `cate app install` et `update`, ce brief dit exporter et importer (voir Q9).
- `docs/architecture.md` §5 (état), §12.3 (partitions et verrou d'origine), « The app panel » (table des panneaux).
- Code : `src/panels/app/` (contract, runtime, session), `src/shells/desktop/main/webSecurity.ts`, `skills/panneau-perso/`.

## Clarifications

### Session 2026-11-20

- Q: Un panneau importé est du code d'un tiers : qui décide qu'il tourne ? → A: seul un humain, par un clic dans l'interface d'un client. Pas un agent, pas la CLI `cate` (FR-017, FR-018). C'est le même niveau de garantie que le clic « Envoyer » du panneau agence.
- Q: L'accord est-il un réglage de pratique (spec 005, « pratiques réglables ») ? → A: non. Le cap produit (le fork sert n'importe quel dev) rend réglables les pratiques de travail, pas le plancher de sécurité. Aucun réglage, aucun preset ne supprime la carte d'import ni le clic. Ce qui reste réglable : la CLI de l'`app` est gardée par `cliAppEnabled` et `cliAppControlEnabled` comme les autres zones (FR-019).
- Q: Un registre ou un index « communautaire » ? → A: non, hors périmètre (008 Q1). Le partage est une copie : un dossier ou un fichier `.cate-panneau`. La question « communautaire » reste ouverte (Q8).
- Q: Menace couverte ? → A: le contenu d'un dossier ou d'un fichier venu de l'extérieur. Pas l'agent de l'utilisateur lui-même, qui écrit déjà dans `~/.cate/panneaux/` avec les droits de l'utilisateur (008 D8, Q3). Un agent qui fait de l'automatisation OS (clic hors de Cate) reste un risque résiduel, le même que pour la boîte de validation.

## Vocabulaire

- **Écart** : un des 8 points de #101 (carte d'accord, `entry`, `name`, hors CSP, origines, FR-016, doc, recette).
- **Panneau local** : dossier écrit par l'agent de l'utilisateur dans `~/.cate/panneaux/`. Son accord tient tant que le manifeste ne change pas (008 Q3).
- **Panneau installé** : dossier arrivé par un import. Son accord porte sur l'empreinte du dossier entier (008 Q3).
- **Paquet** : un fichier `<id>.cate-panneau`, un seul fichier JSON qui contient le dossier (chemin, taille, SHA-256 et octets de chaque fichier). Pas de zip, pas de dépendance (Q1).
- **Import en attente** : un dossier ou un paquet lu, validé et copié en quarantaine dans les données du workspace (`<data>/app-imports/<importId>/`). Il n'est ni servi, ni dans `~/.cate/panneaux/`, ni exécuté.
- **Empreinte du dossier** : `folderFingerprint` de `contract/grant.ts` (SHA-256 des lignes `chemin NUL sha256`). L'empreinte d'un paquet est celle de son dossier.
- **Carte d'import** : la carte de l'interface d'un client qui montre un import en attente et porte le bouton Installer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Les écarts du jalon 1 sont fermés (Priority: P1)

Un panneau perso dit la vérité sur ce qu'il peut faire, signale une page absente, refuse un nom piégé et ne fuit pas par les canaux que la CSP ne couvre pas. La doc dit comment le verrou d'origine tient.

**Why this priority**: sans cela, partager un panneau revient à exposer l'utilisateur à un écart déjà connu (carte d'accord trompeuse, fuite par DNS ou WebRTC). C'est le préalable du partage, et il vaut seul pour les panneaux locaux.

**Independent Test**: un test rouge par écart de logique (liste en tasks, lot 1) ; la page hostile et les huit points d'écran de T028 sont vus par Heifara (lot 6).

**Acceptance Scenarios**:

1. **Given** un panneau qui déclare `permissions.network: ["api.exemple.fr"]`, **When** la carte d'accord s'affiche, **Then** elle dit que les fichiers que l'utilisateur choisit dans la page peuvent lui être envoyés, et plus « sans accès à vos fichiers ».
2. **Given** un manifeste dont `entry` désigne un fichier absent du dossier, **When** le panneau est ouvert, **Then** son état est `error` avec une phrase (« index.html est absent du dossier »), et non `running` sur une page 404 en texte brut.
3. **Given** un `name` qui contient U+200B ou U+2028, **When** le manifeste est lu, **Then** il est refusé avec la phrase de nom invalide.
4. **Given** une page `running`, **When** elle tente un appel WebRTC, un `<link rel="dns-prefetch">` ou un `<link rel="preconnect">` vers un hôte non déclaré, **Then** aucun trafic ne sort (preuve à l'écran, lot 6).
5. **Given** le daemon redémarré sur un autre port, **When** un panneau est rouvert, **Then** l'ancienne origine n'est plus autorisée comme page principale du verrou.
6. **Given** un client sans `webview`, **When** un `addPanel` de type `app` lui est demandé, **Then** le runtime le refuse (FR-010), et pas seulement `grant` et `refuse`.

---

### User Story 2 - Exporter un panneau, sans secret et sans chemin absolu (Priority: P1)

Un dev veut donner un de ses panneaux. Il lance `cate app export <id>` (ou son agent le fait) et obtient `<id>.cate-panneau` plus l'empreinte à communiquer au destinataire. L'export refuse un dossier qui contient un secret évident ou un chemin absolu de sa machine.

**Why this priority**: c'est la moitié « émettre » du partage et la plus sûre : elle ne fait que lire un dossier et écrire un fichier à l'endroit demandé.

**Independent Test**: dossier fixture propre : le paquet est écrit, rejouer l'export donne les mêmes octets. Dossier avec `.env`, `/Users/<nom>/` ou une clé privée : refusé, avec le fichier et la ligne, jamais la valeur.

**Acceptance Scenarios**:

1. **Given** un panneau valide, **When** `cate app export <id> --out ./fusion.cate-panneau`, **Then** le fichier est créé, sa dernière ligne de sortie est l'empreinte du dossier, et le dossier du panneau n'a pas changé d'un octet.
2. **Given** un fichier `.env`, une clé `-----BEGIN PRIVATE KEY-----`, un jeton `ghp_...` ou un chemin `/Users/<nom>/...` dans le dossier, **When** l'export tourne, **Then** il est refusé, la sortie nomme le fichier et la ligne mais jamais la valeur, et aucun paquet n'est écrit.
3. **Given** un dossier avec `.git/`, `node_modules/` ou un lien symbolique, **When** l'export tourne, **Then** `.git/` et `node_modules/` sont omis et dits ; le lien symbolique refuse l'export.
4. **Given** un export suivi d'un import du même paquet, **When** l'import est installé sur un autre workspace, **Then** l'empreinte du dossier installé est égale à celle de l'export.

---

### User Story 3 - Importer : rien ne tourne ni n'est copié avant le clic d'un humain (Priority: P1)

Un dev reçoit un dossier ou un `.cate-panneau`. `cate app import <source>` (lancé par lui ou par son agent) lit la source, la valide et la met en attente. Une carte d'import apparaît dans Cate, avec la source, l'empreinte, les fichiers, les permissions en phrases et les alertes. Rien n'est écrit dans `~/.cate/panneaux/` avant le clic Installer d'un humain.

**Why this priority**: c'est la raison d'être de l'epic et le risque : un panneau importé exécute du code d'un tiers avec une page qui peut lire les fichiers que l'utilisateur lui donne.

**Independent Test**: sur un dossier temporaire, importer un paquet hostile et un paquet sain : `~/.cate/panneaux/` (le dossier de test) reste vide, aucune URL de page n'est servie, `apps.acceptImport` est absent de l'API `cate` ; après un `acceptImport` d'un client avec `webview` et la bonne empreinte, le dossier existe et le panneau est autorisé.

**Acceptance Scenarios**:

1. **Given** un paquet valide, **When** `cate app import fusion.cate-panneau`, **Then** la commande répond « en attente d'accord de l'utilisateur dans Cate », donne l'identifiant et l'empreinte, et n'écrit rien dans `~/.cate/panneaux/`.
2. **Given** un import en attente, **When** un agent cherche à l'accepter par `cate` (n'importe quelle commande), **Then** aucune méthode ne le permet : l'acceptation n'est pas dans l'API `cate` (FR-017).
3. **Given** `--empreinte <début>` communiquée par l'expéditeur, **When** l'empreinte calculée ne commence pas par cette valeur, **Then** l'import est refusé avant toute mise en attente.
4. **Given** un paquet avec un chemin `..`, un chemin absolu, un lien symbolique, deux chemins qui ne diffèrent que par la casse, un `cate-panel.json` absent ou un `id` différent du nom, un fichier de plus de 2 Mio, plus de 200 fichiers ou plus de 10 Mio en tout, **When** l'import tourne, **Then** il est refusé avant toute écriture, avec une phrase.
5. **Given** un `id` déjà présent dans `~/.cate/panneaux/`, **When** la carte s'affiche, **Then** elle montre les fichiers ajoutés, changés et retirés, dit si le panneau existant est local (travail de l'utilisateur) ou installé, et ne propose que Remplacer ou Annuler. Rien n'est écrasé en silence.
6. **Given** `permissions.files.read` non vide et `permissions.network` non vide, ou un hôte de loopback (`localhost`, `127.0.0.1`...) dans `network`, **When** la carte s'affiche, **Then** l'alerte rouge correspondante est visible.
7. **Given** un workspace non approuvé, **When** `cate app import` est lancé, **Then** il est refusé (aucun panneau ne se charge dans ce workspace).
8. **Given** les octets en quarantaine modifiés entre l'affichage de la carte et le clic, **When** l'utilisateur clique Installer, **Then** l'installation est refusée (empreinte relue) et la carte se rafraîchit.

---

### User Story 4 - Un panneau installé qui change redemande l'accord (Priority: P2)

Un panneau installé garde son accord tant que son dossier est octet pour octet celui qui a été accepté. Un fichier modifié (un `git pull` dans le dossier, une retouche, un nouvel import du même `id`) le remet en « à valider », avec la liste des fichiers changés, avant tout rechargement.

**Why this priority**: sans cela, un panneau accepté une fois peut devenir autre chose. Moins urgent que l'import lui-même : sans import, il n'y a pas de panneau installé.

**Independent Test**: installer, changer un octet de `app.js`, relancer le scan : l'état passe à `needs-grant`, la page n'est plus servie, la carte liste `app.js`.

**Acceptance Scenarios**:

1. **Given** un panneau installé et autorisé, **When** un octet d'un fichier change, **Then** l'état passe à `needs-grant` avant tout rechargement, avec la liste des fichiers ajoutés, changés et retirés.
2. **Given** un panneau local (écrit par l'agent), **When** une page change sans que le manifeste change, **Then** l'accord tient (008 Q3, inchangé).
3. **Given** un panneau installé que l'utilisateur refuse, **When** il clique Refuser, **Then** l'accord est retiré et le dossier reste en place, jamais supprimé par Cate.

---

### Edge Cases

- **Import spam** : un agent lance 100 imports. Au plus 10 en attente par workspace, au-delà `cate app import` refuse avec la phrase « 10 imports en attente : en installer ou en annuler un ». Chaque import en attente expire à 24 h et au démarrage du daemon.
- **Deux imports du même `id`** : le second remplace le premier en attente (même `id`) ; l'ancien n'est plus installable.
- **Fichier de panneau local sans accord et import du même `id`** : la carte dit « remplace votre panneau local » ; Remplacer est un choix explicite, jamais le bouton principal.
- **Remplacer pendant que le panneau est ouvert** : le panneau repasse en `needs-grant` si l'empreinte a changé ; il n'est ni tué ni fermé (les enregistrements sont de l'état, pas des commandes).
- **Espace disque plein ou coupure pendant l'installation** : la copie se fait dans un dossier caché voisin (`.import-<id>`, ignoré du scanner) puis `rename` ; un échec laisse `~/.cate/panneaux/<id>/` intact.
- **Fichier en quarantaine supprimé à la main** : l'installation échoue avec une phrase, rien n'est copié.
- **Client sans `webview`** (iOS, par exemple) : aucune carte d'import n'est proposée, `acceptImport` est refusé pour sa connexion.
- **Nom piégé après installation** : le manifeste est reparsé à chaque scan (FR-003) ; U+200B refusé.
- **Dossier d'un dépôt Git cloné par l'utilisateur** : `.git/` n'est jamais lu ni copié ; Cate n'exécute pas `git` (Q2).
- **Hôte déclaré qui est le loopback** : accepté par le manifeste (008 D8, risque résiduel), mais rouge sur la carte.
- **Plusieurs clients sur le même workspace** : la carte d'import vient du runtime (flux `apps.imports`), tous les clients avec `webview` la voient, le premier clic gagne, les autres voient la carte disparaître.

## Requirements *(mandatory)*

### Functional Requirements

Partie 1, écarts du jalon 1 (lot 1) :

- **FR-001**: `grantSentence` MUST dire que les fichiers que l'utilisateur choisit dans la page peuvent être envoyés aux hôtes de `permissions.network`, et MUST ne plus écrire « sans accès à vos fichiers » quand `network` est non vide. Sans hôte : « Il ne peut pas utiliser internet. », sans promesse sur les fichiers que la page peut lire.
- **FR-002**: Une page d'`entry` absente (fichier inexistant, ou répertoire) MUST faire passer la session à `error` avec une phrase, avant que l'URL soit publiée ; l'apparition du fichier MUST la ramener à `running` par le rechargement à chaud existant.
- **FR-003**: `name` MUST refuser U+200B, U+2028, U+2029, U+2060 à U+2064, U+FEFF et U+00AD en plus des caractères déjà refusés (Q6 pour U+200C et U+200D).
- **FR-004**: La session de la page MUST fermer les fuites que la CSP ne couvre pas : WebRTC (aucune connexion pair à pair ni STUN hors du proxy du workspace), DNS prefetch et preconnect (aucune résolution d'un hôte non déclaré). La preuve finale est à l'écran (lot 6) ; la logique de décision (quelle requête est autorisée) est testée en pur.
- **FR-005**: Le verrou d'origine d'une session de panneau MUST ne garder que l'origine courante de la page de ce panneau : une origine remplacée (nouveau port du daemon) MUST être retirée.
- **FR-006**: `docs/architecture.md` §12.3 MUST décrire le verrou d'origine (`lockGuestSession`, le jeu d'origines, ce que la CSP ne couvre pas).
- **FR-007**: Le contrat MUST rester pur et le parseur du manifeste unique ; aucune des corrections ne MUST ajouter une dépendance.
- **FR-008**: Chaque correction de logique MUST avoir un test vu rouge avant le code (constitution VI).
- **FR-009**: Les sept points d'écran de T028 (menu du canvas en moins de 2 s après l'ajout d'un dossier, carte d'accord, rechargement à chaud, dossier supprimé, manifeste cassé, workspace non approuvé, page hostile, et l'import hostile de la partie 2) MUST figurer dans un lot de recette que fait Heifara, sans qu'un agent lance l'app.
- **FR-010**: Un client sans `webview` MUST ne pas pouvoir créer l'enregistrement d'un panneau `app` : le runtime refuse l'`addPanel` (008 FR-016). Où se place ce contrôle est Q7.

Partie 2, partage (lots 2 à 5) :

- **FR-011**: Le paquet `.cate-panneau` MUST être un seul fichier JSON `{schema: 1, id, fingerprint, files: [{path, size, sha256, data}]}` (`data` en base64) ; il MUST être reproductible (mêmes octets pour le même dossier) et son `fingerprint` MUST être recalculé et comparé à l'import.
- **FR-012**: `cate app export <id> [--out <fichier>]` MUST ne rien écrire dans le dossier du panneau, MUST omettre `.git/` et `node_modules/` en le disant, MUST refuser un lien symbolique, un `.env*`, une clé privée, un jeton reconnu (`ghp_`, `sk-`, `AKIA`) et un chemin absolu de la machine (`/Users/`, `/home/`), en nommant le fichier et la ligne, jamais la valeur. Ce contrôle réduit une erreur courante, il ne prouve pas l'absence de secret : la sortie le dit.
- **FR-013**: `cate app import <source>` MUST accepter un dossier ou un `.cate-panneau` de la machine du runtime ; il MUST valider avant d'écrire quoi que ce soit : manifeste (parseur unique), `id` égal au nom du dossier ou à l'`id` du paquet, chemins relatifs sans `..`, aucun lien symbolique, aucune collision de casse, au plus 200 fichiers, 2 Mio par fichier, 10 Mio en tout (valeurs de départ, Q10). Il MUST ne pas exécuter `git`, ne rien télécharger, ne pas ouvrir d'URL.
- **FR-014**: `import` MUST copier la source dans `<data>/app-imports/<importId>/` (quarantaine, hors de `~/.cate/panneaux/`, jamais servie), calculer l'empreinte, publier l'import en attente dans le flux `apps.imports`, et répondre à l'appelant avec l'identifiant et l'empreinte seulement.
- **FR-015**: `--empreinte <début>` MUST faire échouer l'import avant la mise en attente si l'empreinte calculée ne commence pas par la valeur (au moins 8 caractères hexadécimaux). C'est la vérification d'origine : l'expéditeur donne l'empreinte par un autre canal. Sans ce paramètre, la carte montre l'empreinte et la source, et le dit.
- **FR-016**: La carte d'import MUST montrer : le nom et la description, la source telle que désignée (chemin ou nom du paquet), l'empreinte, le nombre et la taille des fichiers, les permissions en phrases (FR-001), les alertes rouges (fichiers lisibles et réseau ensemble, hôte de loopback, `**/*` dans `files.read` quand le pont existe), et, si l'`id` existe déjà, la différence de fichiers et la nature du panneau remplacé.
- **FR-017**: L'installation MUST être une méthode de la capability `apps` (`acceptImport`), absente de l'API `cate` et de la CLI. Elle MUST exiger : une connexion cliente avec `webview` (pas le runtime lui-même), un workspace approuvé, l'empreinte de la carte lue, et les octets de la quarantaine dont l'empreinte relue est la même. Rien d'autre ne MUST écrire dans `~/.cate/panneaux/` (008 FR-017).
- **FR-018**: L'installation MUST copier dans un dossier caché voisin puis renommer, MUST écrire l'accord `installed` (source, origine, empreinte du dossier, liste des fichiers acceptés avec leur SHA-256) dans `<data>/app-grants.json`, et MUST retirer l'import en attente. Remplacer un `id` existant MUST être un choix explicite portant sur cet `id`.
- **FR-019**: La CLI de l'`app` MUST être gardée par une zone `cliApp` (lecture : `list`, `imports` ; contrôle : `export`, `import`) comme les autres zones ; `import` stage seulement.
- **FR-020**: Un panneau installé MUST repasser en `needs-grant` à la moindre différence entre son dossier et l'empreinte acceptée, avant tout rechargement, avec la liste des fichiers changés ; une page ou un manifeste modifié d'un panneau local suit la règle existante (008 Q3). Le scanner MUST publier `source: 'installed'` pour un panneau dont l'accord est `installed`.
- **FR-021**: Au plus 10 imports en attente par workspace, 24 h de vie, purgés au démarrage du daemon et quand l'`id` est réimporté.
- **FR-022**: Le skill `panneau-perso` MUST remplacer sa section « Partage » (copie à la main) par la procédure d'export et d'import, avec ce qu'on ne met jamais dans un panneau (secret, chemin absolu), dans la même PR que la CLI (008 FR-015).
- **FR-023**: Rien de personnel n'est codé en dur : les chemins, hôtes ou noms de dev n'apparaissent ni dans le code ni dans les fixtures ; la méthode de Heifara n'est qu'un cas de la configuration.

### Key Entities

- **Paquet** (`.cate-panneau`) : voir Vocabulaire.
- **Import en attente** : `{importId, appId, source: string, fingerprint, files: FolderFile[], size, at, replaces?: 'local' | 'installed', diff?: {added, changed, removed}}`. Vit en mémoire du daemon et dans `<data>/app-imports/`, jamais dans `~/.cate/panneaux/`.
- **Accord `installed`** : `AppGrant` existant avec `source: 'installed'`, `origin`, `folderFingerprint`, plus `files` (liste acceptée, pour montrer le diff).
- **Méthodes de la capability `apps`** : `imports` (liste, flux), `acceptImport {importId, fingerprint}`, `dropImport {importId}`.
- **Méthodes de l'API `cate`** : `app.list`, `app.imports`, `app.export`, `app.import`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Les 6 écarts de logique de #101 (carte, `entry`, `name`, hors CSP, origines, FR-016) ont chacun un test vu rouge puis vert ; la doc est relue dans la PR ; la recette (T028) est un lot de Heifara.
- **SC-002**: Sur un dossier de test, `import` d'un paquet sain ou hostile laisse `~/.cate/panneaux/` à 0 fichier et 0 URL servie, dans 100 % des cas de la table des fixtures.
- **SC-003**: Un test de registre prouve qu'aucune méthode de l'API `cate` n'appelle `acceptImport` ni n'écrit dans `~/.cate/panneaux/`.
- **SC-004**: Un octet changé dans un panneau installé le remet en `needs-grant` dans 100 % des cas (test sur chaque fichier de la fixture).
- **SC-005**: Export puis import (deux workspaces de test) donne la même empreinte de dossier.
- **SC-006**: Au moins 12 fixtures hostiles (liste du lot 2) sont refusées avant toute écriture, avec une phrase chacune.
- **SC-007**: `npm run lint:deps`, `typecheck`, `lint` et `npm test` verts sur la dernière PR de chaque lot.
- **SC-008**: Coût de service : 0 € par mois, aucun registre, aucun hébergement. Coût en jetons ou en euros de l'implémentation : non chiffré.

## Questions ouvertes

Chaque question a une hypothèse de travail ; aucune ne bloque l'écriture du plan.

- **Q1. Format du paquet** : JSON seul (hypothèse, 0 dépendance, lisible et diffable) contre zip (008 D11 parle d'un « zip du dossier », il n'y a pas de bibliothèque zip dans `package.json`, et Node n'en lit pas). Hypothèse : JSON. À aligner avec 008 côté Skills.
- **Q2. Source Git** : Cate ne clone pas (hypothèse). L'utilisateur clone puis importe le dossier ; `.git/` est ignoré. Cloner depuis Cate ajoute un processus externe, des hooks et des sous-modules à traiter.
- **Q3. Un clic ou deux** : la carte d'import vaut accord (une carte, Installer = copier et autoriser ces permissions, hypothèse). Sinon une deuxième carte s'afficherait à la première ouverture avec les mêmes mots.
- **Q4. Collision d'`id`** : Remplacer ou Annuler seulement (hypothèse). Renommer exige de réécrire l'`id` du manifeste dans la copie, donc une empreinte différente de celle annoncée par l'expéditeur.
- **Q5. Où va l'export** : `--out` est un chemin de la machine du runtime (hypothèse). Un client distant récupère le fichier par les opérations de fichiers existantes. Pas de boîte de dialogue.
- **Q6. U+200C et U+200D** (ZWNJ et ZWJ) : autorisés (hypothèse), car ils composent des emojis et des écritures non latines. Les refuser casse ces noms.
- **Q7. Où se place le contrôle de FR-010** : une propriété déclarée de la définition (`requires: ['webview']`, lue par le chemin de création du runtime) est le choix « déclarer une fois », mais il touche `src/panels/framework/` et le chemin `addPanel`. Hypothèse : le lot 1 commence par un test rouge qui localise le chemin ; si l'écart de code dépasse une propriété de définition et son contrôle, l'écart FR-010 devient une issue à part, pas un lot qui grossit.
- **Q8. « Communautaire »** : pas de registre ni d'index avant un besoin démontré (008 Q1). Un index serait une liste de dépôts dans un fichier, sans modération par Cate. À rouvrir quand deux devs échangent des panneaux sans passer par un collègue.
- **Q9. Noms de commande** : `cate app export` et `cate app import` (ce brief) ; 008 écrit `install` et `update`. Hypothèse : garder `import`, qui ne fait que mettre en attente (le mot `install` suggère un effet qu'il n'a pas), et traiter la mise à jour comme un import du même `id`. À aligner avec 008 FR-014.
- **Q10. Plafonds** (200 fichiers, 2 Mio par fichier, 10 Mio en tout, 10 en attente, 24 h) : valeurs de départ sans mesure. Ajustables sans changer le format.
- **Q11. Fichiers de la spec Skills 008 à mettre à jour** : la section « Partage » du skill et le tableau FR-014 de 008 ; le dépôt Skills n'est pas touché ici (lecture seule). À confier à l'orchestrateur de Skills.
- **Q12. Verrou `webRequest` pour tout type de ressource** : filtrer chaque requête de la session de panneau par origine et hôtes déclarés est plus strict que la CSP seule, mais double une règle que la CSP porte déjà. Hypothèse : le garder pour WebRTC et les préchargements seulement, pas pour les images et scripts (déjà couverts). Preuve à l'écran.
