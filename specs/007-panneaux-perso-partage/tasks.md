---

description: "Tâches : panneaux perso, écarts du jalon 1 puis partage (spec 007, issue #101)"
---

# Tasks: Panneaux perso, écarts du jalon 1 puis partage

**Input**: `specs/007-panneaux-perso-partage/` (spec.md, plan.md)

**Prerequisites**: plan.md, spec.md. Tests d'abord (constitution VI) : chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit des fichiers tourne dans un dossier temporaire et échoue s'il voit le vrai `~/.cate` ou `~/.claude`.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, `npm ci`, `npm install`, écrire dans le vrai `~/.cate/panneaux/`, merge, push sur `main`, force-push, suppression de branche. Aucune dépendance ajoutée.

**État** : spec écrite, aucune tâche commencée. Aucun coût en jetons ou en euros mesuré : « non chiffré ». Un lot = une PR, un implémenteur, une journée environ.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie). **[US1] à [US4]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- Un vérificateur différent de l'implémenteur relit le diff et relance typecheck, lint, `lint:deps` et tests une fois sur le HEAD annoncé.

## Lot 1 : écarts du jalon 1 (1 j, #101, US1)

**But** : fermer les six écarts de logique et la doc de #101. Préalable du partage ; vaut seul pour les panneaux locaux.

**Dépend de** : rien. **Parallélisable avec** : lot 2 (aucun fichier commun).

**Fichiers touchés** : `src/panels/app/contract/grant.ts`, `src/panels/app/contract/grant.test.ts`, `src/panels/app/contract/manifest.ts`, `src/panels/app/contract/manifest.test.ts`, `src/panels/app/runtime/server.ts`, `src/panels/app/runtime/server.test.ts`, `src/panels/app/session.ts`, `src/panels/app/session.test.ts`, `src/shells/desktop/main/webSecurity.ts`, `src/shells/desktop/main/webSecurity.test.ts`, `src/panels/app/definition.ts` (FR-010 si Q7 tient), `docs/architecture.md` (§12.3).

**Tests d'acceptation (à voir rouges)** :

- [ ] T101 [P] [US1] `grant.test.ts` : avec `network: ["api.exemple.fr"]`, la phrase contient « les fichiers que vous choisissez » et « api.exemple.fr » et ne contient pas « sans accès à vos fichiers » ; sans hôte, elle dit « ne peut pas utiliser internet ». Vu rouge : l'ancienne phrase passe le premier contrôle négatif.
- [ ] T102 [P] [US1] `server.test.ts` : `urlFor(id, 'absent.html')` rejette avec « absent.html est absent du dossier » ; `entry` désignant un répertoire rejette aussi ; `entry` présent rend l'URL. `session.test.ts` : un serveur factice qui rejette fait passer l'état à `error` (message) ; quand le fichier apparaît (`onPage`), l'état repasse à `running`.
- [ ] T103 [P] [US1] `manifest.test.ts` : un `name` contenant U+200B, U+2028, U+2029, U+2060, U+FEFF ou U+00AD est refusé avec la phrase de nom ; U+200D dans un emoji composé est accepté (hypothèse Q6) ; les caractères déjà refusés le restent.
- [ ] T104 [P] [US1] `webSecurity.test.ts` : la fonction pure qui décide si une requête d'une session de panneau est permise (type de ressource, origine, hôtes déclarés) : `mainFrame` hors origine refusée ; une ressource vers un hôte non déclaré refusée ; vers un hôte déclaré permise ; une origine remplacée n'est plus permise (FR-005). Le réglage WebRTC est une fonction pure testée sur sa valeur (`disable_non_proxied_udp`) et sur la sélection des partitions `app-` seulement.
- [ ] T105 [US1] FR-010 : test rouge qui localise le chemin de création du runtime (`src/panels/framework/runtime/createPanel.ts` et l'op `addPanel`) et montre si un client sans `webview` peut aujourd'hui créer un `app`. Sortie du test citée dans le rapport. Décision Q7 : propriété de définition `requires: ['webview']` si le contrôle tient en quelques lignes, sinon issue à part et ligne dans le rapport.
- [ ] T106 [P] [US1] `docs/architecture.md` §12.3 : le verrou d'origine (un jeu d'une origine par session de panneau, ce que la CSP ne couvre pas, les trois mesures de FR-004). Relu, aucun test.

**Implémentation** :

- [ ] T107 [US1] `contract/grant.ts` : `grantSentence` selon FR-001 (rend T101 vert).
- [ ] T108 [US1] `runtime/server.ts` : `urlFor` vérifie le fichier réel d'`entry` ; `session.ts` n'a besoin que de ses messages existants (rend T102 vert).
- [ ] T109 [US1] `contract/manifest.ts` : `UNSAFE_TEXT` étendu (rend T103 vert).
- [ ] T110 [US1] `webSecurity.ts` : origines remplacées, filtre des ressources, politique WebRTC, `X-DNS-Prefetch-Control: off` via `responseHeaders` de `server.ts` (rend T104 vert).
- [ ] T111 [US1] FR-010 selon T105 ; code mort : la phrase « sans accès à vos fichiers » et son test.
- [ ] T112 Vérificateur : relit le diff, relance `npm run typecheck`, `npm run lint`, `npm run lint:deps`, `npm test` sur le HEAD annoncé. Rapport : « non vérifié à l'écran : WebRTC, DNS prefetch, preconnect (lot 6) ».

## Lot 2 : paquet, export, mise en attente (1 j, US2, US3)

**But** : la logique pure et runtime du partage, sans interface ni CLI : valider un dossier ou un paquet, exporter, mettre en quarantaine, tenir le registre des imports en attente.

**Dépend de** : rien. **Parallélisable avec** : lot 1 (une ligne de réexport dans `contract.ts` est la seule intersection avec les autres lots).

**Fichiers touchés** : `src/panels/app/contract/bundle.ts` (nouveau), `src/panels/app/contract/bundle.test.ts` (nouveau), `src/panels/app/contract.ts` (réexport), `src/panels/app/runtime/export.ts` et `export.test.ts` (nouveaux), `src/panels/app/runtime/import.ts` et `import.test.ts` (nouveaux), `src/panels/app/test/fixtures/` (paquets et dossiers hostiles, générés par le test, rien de personnel).

**Tests d'acceptation (à voir rouges)** :

- [ ] T201 [P] [US3] `bundle.test.ts` : `parseBundle` et `validateFolder` refusent les 13 fixtures hostiles du plan (`..`, absolu, `C:\`, lien symbolique, casse, manifeste absent, `id` différent, JSON invalide, empreinte fausse, 201 fichiers, 2 Mio + 1, 10 Mio + 1, nom U+200B) avec une phrase chacune ; un paquet sain passe ; l'empreinte du paquet égale `folderFingerprint` du dossier.
- [ ] T202 [P] [US2] `bundle.test.ts` : `scanSecrets` trouve `.env`, `*.pem`, `id_rsa*`, `-----BEGIN PRIVATE KEY-----`, `ghp_`, `sk-`, `AKIA`, `/Users/x/`, `/home/x/` et rend fichier, ligne et genre, jamais la valeur (le test cherche la valeur dans la sortie et échoue si elle y est).
- [ ] T203 [P] [US2] `export.test.ts` (dossier temporaire) : export d'un dossier sain écrit le paquet, deux exports donnent les mêmes octets, `.git/` et `node_modules/` sont omis et dits, le dossier source est inchangé octet pour octet ; un lien symbolique ou un secret refuse l'export sans écrire de fichier.
- [ ] T204 [P] [US3] `import.test.ts` : `stage` d'un paquet sain écrit sous `<data>/app-imports/<importId>/` et rien dans le dossier des panneaux (comparer l'arbre avant et après) ; chaque fixture hostile laisse `<data>` et le dossier des panneaux intacts ; `--empreinte` fausse ou trop courte (moins de 8) refuse avant écriture ; 11e import refusé ; import du même `id` remplace le précédent en attente ; un import de plus de 24 h est purgé (horloge simulée) ; au démarrage, la quarantaine est vidée.
- [ ] T205 [US3] `import.test.ts` : `replaces` vaut `local` pour un dossier sans accord, `installed` pour un accord `installed`, rien sinon ; `diff` liste fichiers ajoutés, changés, retirés par SHA-256.

**Implémentation** :

- [ ] T206 [US3] `contract/bundle.ts` : `parseBundle`, `validateFolder`, `scanSecrets`, constantes des plafonds (Q10), hash injecté. Rend T201, T202 verts.
- [ ] T207 [US2] `runtime/export.ts` (rend T203 vert).
- [ ] T208 [US3] `runtime/import.ts` : `stage`, registre et flux, purge (rend T204, T205 verts). Aucun appel à `git`, aucun accès réseau.
- [ ] T209 Vérificateur : relit, relance typecheck, lint, `lint:deps`, tests ; confirme par grep qu'aucun import de `simple-git`, `child_process` ni `fetch` n'est dans `runtime/import.ts` et `runtime/export.ts`.

## Lot 3 : accord à l'import, installation, panneau installé qui change (1 j, US3, US4)

**But** : la seule voie qui écrit dans `~/.cate/panneaux/`, et le contrôle d'empreinte d'un panneau installé.

**Dépend de** : lot 1 (il modifie `grant.ts` et `session.ts` que le lot 1 a modifiés), lot 2 (il consomme `stage` et le registre). **Parallélisable avec** : aucun lot (les lots 4 et 5 attendent son contrat).

**Fichiers touchés** : `src/panels/app/contract/capability.ts`, `src/panels/app/runtime/capability.ts`, `src/panels/app/runtime/capability.test.ts`, `src/panels/app/runtime.ts`, `src/panels/app/runtime.test.ts`, `src/panels/app/contract/grant.ts`, `grant.test.ts`, `src/panels/app/contract/snapshot.ts`, `src/panels/app/session.ts`, `session.test.ts`, `src/panels/app/runtime/scan.ts`, `scan.test.ts`, `src/panels/app/runtime/grants.ts`, `grants.test.ts`, `src/panels/app/runtime/import.ts` (méthode `accept`), `docs/architecture.md` (paragraphe « The app panel » et arbre de `<data>` : `app-imports/`).

**Tests d'acceptation (à voir rouges)** :

- [ ] T301 [P] [US3] `import.test.ts` : `accept` refuse pour la connexion du runtime (`null`), pour un client sans `webview`, pour un workspace non approuvé, pour une empreinte différente de celle de la carte, pour des octets de quarantaine modifiés après la carte, pour un `importId` inconnu ou expiré ; chaque refus laisse le dossier des panneaux et `app-grants.json` inchangés.
- [ ] T302 [P] [US3] `import.test.ts` : `accept` d'un paquet sain crée `<id>/` avec les mêmes octets, l'empreinte du dossier égale celle de l'export, l'accord `installed` est écrit (origine, empreinte, `files`), l'import est retiré ; une coupure simulée au `rename` laisse le dossier précédent intact et aucun `.import-*` visible du scanner ; `accept` sur un `id` existant sans choix de remplacement refuse.
- [ ] T303 [P] [US4] `grant.test.ts` et `session.test.ts` : un panneau `installed` dont un seul octet d'un fichier change passe de `running` à `needs-grant` avant tout rechargement (`reload` ne bouge pas), avec `changes` listant le fichier ; un panneau `local` dont une page change garde `running` (008 Q3 inchangé) ; refuser retire l'accord sans supprimer le dossier.
- [ ] T304 [P] [US3] `scan.test.ts` : l'entrée d'un panneau avec accord `installed` a `source: 'installed'` ; sans accord, `local`. `folderFiles` n'est calculé que pour un accord `installed` (test : un panneau local ne déclenche aucune lecture d'octets de pages).
- [ ] T305 [P] [US3] `capability.test.ts` : la capability `apps` expose `imports` (liste et flux), `acceptImport`, `dropImport`, et son contrat est pur (le test de dépendances du dépôt passe).
- [ ] T306 [US3] Test de registre : aucune méthode de `CATE_API` (`src/panels/api.ts`) ne nomme `acceptImport` ni ne rend un handler qui écrit dans le dossier des panneaux (SC-003). Vu rouge au moment où le lot 4 ajoute une méthode : le test doit exister avant.

**Implémentation** :

- [ ] T307 [US3] `contract/capability.ts` et `runtime/capability.ts` : `imports`, `acceptImport`, `dropImport`. `runtime.ts` câble le registre du lot 2 et le grants.
- [ ] T308 [US3] `runtime/import.ts` : `accept` (copie dans `.import-<id>`, `rename`, ancien dossier déplacé puis supprimé seulement après succès, accord `installed`, retrait de l'import). Rend T301, T302 verts.
- [ ] T309 [US4] `contract/grant.ts`, `snapshot.ts`, `session.ts`, `runtime/scan.ts`, `runtime/grants.ts` : `AppGrant.files`, `changes`, `folderFingerprint` dans `statusOf`, `source` lu de l'accord. Rend T303, T304 verts.
- [ ] T310 [US3] `docs/architecture.md` : quarantaine, acceptation, accord `installed`, `app-imports/` dans l'arbre de `<data>`.
- [ ] T311 Vérificateur : relit, relance les quatre commandes, lit `runtime/import.ts` pour confirmer que `accept` est la seule écriture sous le dossier des panneaux ; liste les occurrences de `panneauxDir` en écriture (grep).

## Lot 4 : CLI `cate app` et skill (0,5 j à 1 j, US2, US3)

**But** : export et import depuis un terminal (donc par un agent), zone `cliApp`, et le skill qui les enseigne.

**Dépend de** : lots 2 et 3. **Parallélisable avec** : lot 5 (aucun fichier commun).

**Fichiers touchés** : `src/panels/app/contract/api.ts` (nouveau, ou étendu si le jalon 2 de la spec 008 est arrivé), `src/panels/app/definition.ts` (champ `api`), `src/panels/api.ts` (une ligne), `src/runtime/daemon/compose/` (câblage du service, une ligne), `skills/panneau-perso/SKILL.md` (section « Partage »), `skills/cate-cli/references/` (la page de l'`app`), `src/cli/` tests de génération si existants.

**Tests d'acceptation (à voir rouges)** :

- [ ] T401 [P] [US2] Test du moteur de la CLI : `cate app export <id> --out <fichier>` apparaît dans l'aide générée avec ses arguments, sa zone (`cliApp` contrôle) et son résumé ; sans le réglage, il répond le code de zone désactivée.
- [ ] T402 [P] [US3] Test de service : `app.import` avec un dossier de test répond l'identifiant et l'empreinte, rien d'autre, et ne laisse rien sous le dossier des panneaux ; `app.imports` ne rend ni octets ni chemins de quarantaine ; `--empreinte` fausse échoue.
- [ ] T403 [US3] T306 passe au vert avec les méthodes ajoutées (registre).
- [ ] T404 [P] Le skill : un test `evals.json` ou de contenu qui vérifie que la section « Partage » cite `cate app export` et `cate app import`, la phrase « seul l'utilisateur installe, par un clic dans Cate », l'interdit de mettre un secret ou un chemin absolu, et ne cite plus la copie à la main dans `~/.cate/panneaux/` comme procédure.

**Implémentation** :

- [ ] T405 [US2] `contract/api.ts` : `defineCliArea` (`cliAppEnabled`, `cliAppControlEnabled`, code de refus, détail), `app.list`, `app.imports`, `app.export`, `app.import` ; `definition.ts` et `src/panels/api.ts`.
- [ ] T406 [US3] Services du runtime branchés sur `export.ts` et `import.ts` (lots 2 et 3), sans méthode d'acceptation.
- [ ] T407 `skills/panneau-perso/SKILL.md` et `skills/cate-cli/references/` : section « Partage » (export, import, empreinte à communiquer, secrets, ce qui se passe à l'écran). Code mort : l'ancienne section.
- [ ] T408 Vérificateur : relit, relance les quatre commandes, `cate app --help` lu sur la sortie du moteur de test (pas d'app lancée).

## Lot 5 : carte d'import dans l'interface desktop (1 j, US3, US4)

**But** : le clic d'un humain : voir un import en attente, le comprendre, l'installer ou l'annuler ; voir un panneau installé « à valider ».

**Dépend de** : lot 3 (contrat de la capability). **Parallélisable avec** : lot 4.

**Fichiers touchés** : `src/shells/desktop/ui/panels/app/ImportCard.tsx` (nouveau) et `ImportCard.test.tsx` (nouveau), `AppsPage.tsx` et `AppsPage.test.tsx`, `GrantCard.tsx` (liste des fichiers changés pour un installé), `useApps.ts` (flux `imports`), `AppPanel.tsx` si la carte de changement y entre.

**Tests d'acceptation (à voir rouges, jsdom)** :

- [ ] T501 [P] [US3] `ImportCard.test.tsx` : la carte affiche nom, description, source, 12 premiers caractères de l'empreinte, nombre et taille des fichiers, la phrase de permissions (FR-001) ; Installer envoie `acceptImport` avec l'empreinte **de la carte** ; Annuler envoie `dropImport`.
- [ ] T502 [P] [US3] Alertes rouges : `files.read` non vide avec `network` non vide ; un hôte `localhost`, `127.0.0.1`, `[::1]` ou `*.localhost` dans `network` ; absence d'alerte pour un manifeste sans réseau.
- [ ] T503 [P] [US3] Remplacement : un `id` existant montre ajoutés, changés, retirés, dit « remplace votre panneau local » ou « remplace un panneau installé », et le bouton Remplacer n'est pas le bouton principal ; l'échec du runtime (empreinte changée) rafraîchit la carte sans installer.
- [ ] T504 [P] [US3] Un client sans `webview` ne montre aucune carte d'import (`clientHas`).
- [ ] T505 [P] [US4] La carte d'un installé qui a changé liste les fichiers changés et ne monte pas la page avant le clic.

**Implémentation** :

- [ ] T506 [US3] `ImportCard.tsx`, `AppsPage.tsx`, `useApps.ts` ; tout en Tailwind et composants existants (`Button`, `PanelCenteredState`), aucune logique d'installation dans la vue.
- [ ] T507 [US4] `GrantCard.tsx` et `AppPanel.tsx` : liste des fichiers changés.
- [ ] T508 Un parcours Playwright de l'import est **écrit, non lancé** (e2e : importer un paquet fixture, voir la carte, installer, voir le panneau en `running`) ; le rapport dit « non exécuté ».
- [ ] T509 Vérificateur : relit, relance typecheck, lint, `lint:deps`, tests jsdom ; aucune fenêtre ouverte.

## Lot 6 : recette à l'écran (Heifara, 0,5 j, FR-009)

**But** : ce qu'aucun agent ne peut montrer (constitution X). Rien n'est lancé par un agent ; un agent prépare seulement les dossiers de test et la liste à cocher.

**Dépend de** : lots 1, 3 et 5 pour l'import ; lot 1 seul pour la partie du jalon 1. **Parallélisable avec** : lot 4.

**Fichiers touchés** : aucun. Livrable : `specs/007-panneaux-perso-partage/rapport-recette.md` (compte rendu de Heifara, une ligne par point, vu ou non vu).

- [ ] T601 [H] T028, point 1 : le menu du canvas montre un panneau en moins de 2 s après l'ajout d'un dossier à `~/.cate/panneaux/`.
- [ ] T602 [H] T028, point 2 : la carte d'accord est celle de FR-001 (lire la phrase) ; rien de la page ne tourne avant le clic.
- [ ] T603 [H] T028, points 3 à 6 : rechargement à chaud ; dossier supprimé (état `missing`) ; manifeste cassé (une phrase, les autres panneaux intacts) ; workspace non approuvé (aucun panneau ne se charge).
- [ ] T604 [H] T028, point 7 et FR-004 : page hostile qui tente un `RTCPeerConnection` avec un serveur STUN, un `<link rel="dns-prefetch">` et un `<link rel="preconnect">` vers un hôte non déclaré, un `fetch` vers un hôte non déclaré, un `window.open`, une navigation vers une autre origine. Vérifier dans l'onglet réseau de l'outil de développement de la page et dans les journaux du daemon : aucune sortie. Si une fuite apparaît, le lot 1 rouvre (plan, « Réserve »).
- [ ] T605 [H] Import sain : `cate app export` d'un panneau, puis `cate app import` du fichier dans un autre workspace ; la carte s'affiche ; rien n'existe dans `~/.cate/panneaux/` avant Installer ; après Installer, le panneau est `running` et son empreinte est celle de l'export.
- [ ] T606 [H] Import hostile : un paquet avec `..`, un paquet avec un secret dans un `.env` (à l'export), un `id` existant (carte de remplacement), 11 imports (le 11e refusé).
- [ ] T607 [H] Panneau installé modifié : changer un octet de `app.js` dans `~/.cate/panneaux/<id>/` ; le panneau passe en « à valider » avec le fichier listé ; refuser retire l'accord sans supprimer le dossier.
- [ ] T608 [H] Agent : demander à un agent d'un terminal Cate d'installer l'import en attente ; il n'a aucune commande pour le faire (preuve : sa sortie).
