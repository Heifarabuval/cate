# Implementation Plan: Panneaux perso, écarts du jalon 1 puis partage

**Branch**: `docs/spec-panneaux-perso-partage` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: issue #101 pour la partie 1. Spec seule dans cette PR, aucun code.

## Summary

Deux parties. La partie 1 corrige les six écarts de logique de #101 dans `src/panels/app/` et `src/shells/desktop/main/webSecurity.ts`, plus une ligne de doc (§12.3) ; c'est le préalable du partage. La partie 2 ajoute le plus petit partage qui tient : un export vers un fichier JSON `.cate-panneau`, un import qui **met en attente** (quarantaine dans les données du workspace), une carte d'import dans l'interface, et une installation qui n'existe que comme méthode de capability appelée par un client humain, jamais dans l'API `cate`. Un panneau installé garde son accord tant que son dossier est octet pour octet celui qui a été accepté.

| Sujet | Recommandé | Lot | Coût mensuel |
|---|---|---|---|
| Format de partage | Un fichier JSON `.cate-panneau` (chemin, SHA-256, octets en base64) ; un dossier est aussi une source. Pas de zip, pas de git lancé par Cate | 2 | 0 € |
| Mise en attente | `<data>/app-imports/<importId>/`, jamais servie, 10 au plus, 24 h | 2 | 0 € |
| Installation | `apps.acceptImport` (capability, connexion cliente avec `webview`), absente de `CATE_API` | 3 | 0 € |
| Accord d'un installé | `AppGrant` `installed` avec `folderFingerprint` et `files` (existe déjà sauf `files`) | 3 | 0 € |
| Vérification d'origine | `--empreinte <début>` communiquée par l'expéditeur, plus source et empreinte sur la carte. Pas de signature, pas de registre | 4 | 0 € |
| CLI | `cate app export`, `import`, `imports`, zone `cliApp` | 4 | 0 € |
| Interface | Carte d'import dans la page « Panneaux perso » et à l'ouverture | 5 | 0 € |
| Dépendance ajoutée | Aucune | | 0 € |

Coût d'implémentation en jetons ou en euros : non chiffré (aucune mesure). Maintenance : une fonction pure de validation à tenir, des plafonds en constantes.

## Technical Context

**Language/Version**: TypeScript strict (Node dans le daemon, React côté desktop). **Primary Dependencies**: aucune ajoutée (`node:crypto`, `node:fs`, `simple-git` non utilisé). **Storage**: `<data>/app-imports/<importId>/` (nouveau), `<data>/app-grants.json` (existant, champ `files` ajouté à l'accord `installed`), `~/.cate/panneaux/<id>/` (écrit seulement par l'acceptation). **Testing**: Vitest dans le dossier temporaire ; aucun test ne voit le vrai `~/.cate`. Aucun e2e exécuté (constitution X) : les tests d'écran sont écrits ou listés, Heifara les voit. **Target Platform**: macOS Apple silicon (VIII). **Project Type**: desktop-app. **Scale/Scope**: un utilisateur, quelques dizaines de panneaux, un paquet de 10 Mio au plus.

## Constitution Check

| Principe | Lecture ici |
|---|---|
| I. Couches et côtés | La validation du paquet et l'empreinte sont des contrats purs (`contract/bundle.ts`, hash injecté, comme `grant.ts`) ; lecture et écriture de fichiers dans `runtime/` ; la carte est dans `shells/desktop/ui/panels/app/`. Les hôtes de loopback viennent de `runtime/tunnel/contract` (`isLoopbackHostname`), un contrat d'une couche plus basse. |
| II. Déclarer une fois | Méthodes de l'API `cate` dans `contract/api.ts` (`defineCateApi`), zone `cliApp` par `defineCliArea`, méthodes de la capability dans `contract/capability.ts`. Aucune commande écrite à la main dans la CLI. |
| III. Coupes nettes | La phrase « sans accès à vos fichiers » disparaît, pas de réexport. La section « Partage » (copie à la main) du skill est remplacée. Le champ `source: 'local'` codé en dur du scanner est remplacé par la valeur de l'accord. |
| IV. Pas de branchement sur le contexte | Aucun `if (type === 'app')` dans le code partagé. `webview` se demande par `clientHas`. |
| V. Le runtime est l'application | Stage, copie, empreinte, quarantaine, accord : runtime. La vue demande, la session agit (`acceptImport` est une méthode du runtime ; la vue ne copie rien). |
| VI. Tests d'abord | Chaque lot liste ses tests rouges avant le code. |
| VII. Le plus simple d'abord | JSON plutôt que zip, empreinte existante, `grantStatus` existant, pas de signature, pas de git. |
| VIII. macOS arm64 | Rien de spécifique. |
| IX. Écart minimal avec upstream | Tout ce qui touche l'`app` est déjà un écart du fork. Les fichiers partagés avec upstream (`webSecurity.ts`, `src/panels/framework/`) sont modifiés au plus petit possible (une propriété de définition, un filtre). |
| X. Aucune fenêtre | Aucun lot ne lance l'app ; la recette est à Heifara. |

## Menace et modèle d'accord

Un panneau importé est du code d'un tiers. Il tourne dans une page web avec : une partition en mémoire, vide ; une CSP (`script-src 'self'`, `connect-src` limité aux hôtes déclarés) ; aucun accès à Node ni à `window.cateDesktop` ; et, aux jalons suivants, un pont filtré. Ce que la page peut quand même faire, et la réponse :

| Menace | Réponse | Lot |
|---|---|---|
| La page lit un fichier que l'utilisateur lui donne (`<input type=file>`) et l'envoie à un hôte déclaré. | Carte honnête (FR-001), alerte rouge quand `network` est non vide à l'import (FR-016). | 1, 5 |
| La page fuit par un canal que la CSP ne couvre pas : WebRTC (STUN), `dns-prefetch`, `preconnect`. | FR-004 : politique WebRTC de la session, en-tête de refus du DNS prefetch, filtre `webRequest` des requêtes de ressources hors origine et hôtes déclarés (Q12). Preuve à l'écran. | 1, 6 |
| La page contourne le verrou d'origine par un ancien port du daemon. | FR-005 : le jeu d'origines n'a qu'une valeur par session. | 1 |
| Le nom ou le texte usurpe un autre panneau ou masque son contenu (U+200B, U+2028, bidi). | FR-003 ; le cadre dessiné par Cate montre l'`id` (« Panneau perso : <id> »), pas seulement le nom. | 1 |
| Un paquet cherche à écrire hors du dossier (`..`, chemin absolu, lien symbolique, casse), ou à épuiser le disque. | Validation pure avant toute écriture, plafonds (FR-013). | 2 |
| Un agent installe un panneau tout seul (prompt injecté, paquet piégé) ou en met 100 en attente. | `acceptImport` hors de l'API `cate` (FR-017), 10 en attente, 24 h (FR-021). | 2, 3 |
| Le paquet est modifié entre la carte et le clic. | L'empreinte est relue sur les octets de la quarantaine avant la copie (FR-017). | 3 |
| Le panneau installé est modifié après l'accord. | `grantStatus` `installed` sur l'empreinte du dossier (FR-020). | 3 |
| Un hôte déclaré est `localhost` ou `127.0.0.1` : la page parle aux services locaux de l'utilisateur. | Accepté par le manifeste (risque résiduel de 008 D8), alerte rouge sur la carte. | 5 |
| Le paquet vient d'un faux expéditeur. | Pas de preuve d'identité sans registre. `--empreinte` permet à l'expéditeur de confirmer l'empreinte par un autre canal ; la carte affiche la source et l'empreinte. Limite dite à l'utilisateur. | 4, 5 |

**Ce qu'un import ne fait jamais sans le clic d'un humain** (chacun a un test) :

1. écrire dans `~/.cate/panneaux/` (création, remplacement, suppression, fichier caché) ;
2. écrire ou modifier un accord (`app-grants.json`) ;
3. servir un octet du paquet (le serveur de pages a pour racine `~/.cate/panneaux/` seule) ;
4. exécuter ou ouvrir la page ;
5. exécuter `git`, un script du paquet, ou contacter une URL ;
6. remplacer un panneau existant, local ou installé ;
7. mettre à jour un panneau installé (jamais de mise à jour automatique).

« Le clic d'un humain » veut dire : un appel de la capability `apps.acceptImport` par une connexion cliente qui déclare `webview`, depuis la carte d'une vue. La CLI et l'API `cate` (donc tout agent dans un terminal) ne l'atteignent pas. Test de registre : l'ensemble des méthodes de `CATE_API` ne contient aucune méthode qui appelle `acceptImport`, et aucune n'écrit dans `~/.cate/panneaux/` hors `export` (qui écrit `--out`). Risque résiduel nommé : un agent qui pilote l'OS et clique hors de Cate (même risque que la boîte de validation).

## Conception

### Partie 1 : écarts (une PR)

- **Carte** (`contract/grant.ts`, `grantSentence`) : si `network` est non vide : « « <nom> » s’exécute dans un cadre isolé. Les fichiers que vous choisissez ici peuvent être envoyés à <hôtes>. » Sans hôte : « Il ne peut pas utiliser internet. ». Elle ne promet rien sur les fichiers lisibles tant que le pont n'existe pas ; le jalon 2 de 008 y ajoute ses phrases.
- **`entry` absent** (`runtime/server.ts`, `urlFor`) : stat du fichier réel avant de rendre l'URL ; une erreur `« <entry> est absent du dossier »` passe par le `catch` existant de `session.decide` (« la page ne peut pas être servie : ... »). Le rechargement à chaud ramène `running` quand le fichier arrive : `onPage` rappelle `decide`.
- **`name`** (`contract/manifest.ts`, `UNSAFE_TEXT`) : ajouter U+00AD, U+200B, U+2028, U+2029, U+2060 à U+2064, U+FEFF. U+200C et U+200D restent permis (Q6).
- **Hors CSP** (`webSecurity.ts`, `server.ts`) : trois mesures, à valider à l'écran (la page hostile) : (a) `webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` sur les contenus d'une partition `app-` (hypothèse : la partition passe par le proxy loopback du workspace, `webPartitions.ts`, un proxy de flux TCP ; sans UDP direct, le STUN ne sort plus. À vérifier à l'écran) ; (b) l'en-tête `X-DNS-Prefetch-Control: off` des réponses de `createAppServer` (`responseHeaders`), plus un filtre `webRequest` des requêtes autres que `mainFrame` hors origine de la page et hôtes déclarés (Q12) ; (c) le test pur de la fonction qui décide « cette requête est-elle permise » (origine courante, hôtes de `permissions.network`). Réserve : Chromium peut ouvrir une connexion préparatoire sans passer par `webRequest` ; si la page hostile montre qu'(a) et (b) ne suffisent pas, le correctif suivant est un changement de politique réseau de la partition, pas un contournement de plus. Non vérifié ici : aucun Electron n'est lancé par la spec.
- **Origines** (`webSecurity.ts`, `lockGuestSession`) : le jeu d'origines d'une session est remplacé (`origins.clear()` puis `add`) par l'origine du `src` courant, au lieu de s'accumuler. Une session de panneau a une seule origine à la fois (une origine par runtime : l'hôte et le port du serveur de pages). La fonction pure est extraite pour être testée sans Electron (`webSecurity.test.ts` existe).
- **FR-016** (`definition.ts`, `src/panels/framework/`) : hypothèse de la spec (Q7) : une propriété déclarée de la définition `requires: ['webview']` lue par le chemin de création du runtime, qui refuse l'`addPanel` pour une connexion sans la fonctionnalité. La tâche commence par un test rouge qui localise le chemin ; si le chemin n'existe pas (`addPanel` est un op de document appliqué par n'importe quel client), la tâche se limite à ce que le runtime sait faire et le dit.
- **Doc** : §12.3 du `docs/architecture.md` (verrou d'origine) et le paragraphe « The app panel » (quarantaine et acceptation après le lot 3).

### Partie 2 : partage

**Paquet** (`contract/bundle.ts`, pur). `parseBundle(text) -> {ok, bundle} | {ok: false, error}` et `validateFolder(files: {path, size}[]) -> error | null` (les mêmes règles de chemin pour un dossier et un paquet) : relatif, sans `..`, sans segment vide, sans `\`, sans lettre de lecteur, sans collision de casse (comparaison en minuscules et NFC), 200 fichiers, 2 Mio par fichier, 10 Mio au total, `cate-panel.json` présent, manifeste valide par `parseManifest`, `id` égal à celui du paquet ou au nom du dossier, `fingerprint` du paquet égal à `folderFingerprint` recalculé. `scanSecrets(files, text) -> {path, line, kind}[]` : fichier nommé `.env*`, `*.pem`, `id_rsa*`, ligne `-----BEGIN ... PRIVATE KEY-----`, `ghp_`, `sk-`, `AKIA` suivis de 16 caractères ou plus, `/Users/<x>/`, `/home/<x>/`. Le hash est injecté.

**Export** (`runtime/export.ts`). Lit le dossier par `lstat` (un lien refuse), omet `.git/` et `node_modules/`, trie les chemins, rend les octets du paquet. Écrit `--out` seulement après `scanSecrets` vide. Reproductible : clés triées, pas d'horodatage.

**Import en attente** (`runtime/import.ts`). `stage(source)` : lit une source (dossier ou paquet), valide, compare `--empreinte`, copie dans `<data>/app-imports/<importId>/` (`importId` aléatoire), enregistre `{importId, appId, source, fingerprint, files, size, at, replaces?, diff?}` dans un registre en mémoire qui publie un flux, purge à 24 h et au démarrage, plafonne à 10 par workspace. `replaces` vient de `scanner.list()` et de l'accord (`local` ou `installed`) ; `diff` compare les SHA-256 du dossier actuel à ceux du paquet. `accept(importId, fingerprint, ctx)` : exige la connexion cliente avec `webview`, le workspace approuvé, l'empreinte de la carte ; relit les octets de la quarantaine et recalcule l'empreinte ; copie dans `~/.cate/panneaux/.import-<id>/` puis `rename` (le scanner ignore les noms qui commencent par `.`) ; écrit l'accord `installed` ; retire l'import. Il ne supprime jamais l'ancien dossier d'un `id` remplacé avant le `rename` réussi : le `rename` d'un dossier non vide échoue sous POSIX, donc l'ancien est déplacé à `.old-<id>-<importId>` puis supprimé après succès (seul cas de suppression, listé dans la PR).

**Accord installé et changement** (`contract/grant.ts`, `session.ts`, `runtime/scan.ts`). `AppGrant.files?: FolderFile[]` ; le scanner expose `folderFiles(id)` (calculé seulement quand l'accord est `installed`, pour ne pas hasher les panneaux locaux à chaque événement) et `source` de l'entrée vient de l'accord ; `AppSession.statusOf` passe `folderFingerprint` ; l'instantané ajoute `changes: {added, changed, removed} | null` pour la carte « à valider » d'un installé.

**CLI** (`contract/api.ts`, `definition.ts`, `src/panels/api.ts`, `runtime/service.ts`). `app.list` (lecture), `app.imports` (lecture, sans le contenu), `app.export` (contrôle), `app.import` (contrôle, met en attente). Zone `cliApp`. Chaque handler est un service du runtime. Si le jalon 2 de 008 a déjà créé `contract/api.ts`, ce lot y ajoute ses méthodes ; sinon il crée le fichier.

**Interface** (`shells/desktop/ui/panels/app/`). Un `ImportCard.tsx` dans `AppsPage` (et affiché une fois à l'ouverture d'un panneau en `needs-grant` d'un installé qui a changé) : nom, description, source, empreinte (12 premiers caractères, copiable), fichiers (nombre, taille), phrases, alertes rouges, diff si remplacement. Boutons Installer (primaire) et Annuler ; sur remplacement, Remplacer (non primaire). La vue demande via `ClientUi` avant le remplacement d'un panneau local. Aucune logique dans la vue (V).

## Fichiers touchés par lot (vue d'ensemble)

| Lot | Fichiers principaux |
|---|---|
| 1 | `src/panels/app/contract/grant.ts`, `manifest.ts`, `runtime/server.ts`, `src/shells/desktop/main/webSecurity.ts`, `src/panels/app/definition.ts`, `docs/architecture.md` (§12.3), tests voisins |
| 2 | `src/panels/app/contract/bundle.ts` (nouveau), `runtime/export.ts` et `runtime/import.ts` (nouveaux), `contract.ts` (une ligne de réexport) |
| 3 | `contract/capability.ts`, `runtime/capability.ts`, `runtime.ts`, `contract/grant.ts`, `contract/snapshot.ts`, `session.ts`, `runtime/scan.ts`, `runtime/grants.ts`, `docs/architecture.md` (paragraphe de l'`app`) |
| 4 | `contract/api.ts` (nouveau ou étendu), `definition.ts`, `src/panels/api.ts`, `src/runtime/daemon/compose/` (câblage), `skills/panneau-perso/SKILL.md`, `skills/cate-cli/references/` |
| 5 | `src/shells/desktop/ui/panels/app/ImportCard.tsx` (nouveau), `AppsPage.tsx`, `GrantCard.tsx`, `useApps.ts`, tests de vue |
| 6 | aucun fichier ; compte rendu de la recette |

## Conflits de fichiers avec les autres epics

Les specs 005 (pratiques réglables), 002 (lots macro de l'orchestrateur) et 006 (coût de l'attente) sont écrites en parallèle ; leurs listes de fichiers étaient « prises » mais non publiées au moment de l'écriture (bus, 17 h 45). Ce qui suit est donc une lecture de **ma** zone, à recouper par l'orchestrateur avec les `plan.md` des trois autres.

| Fichier | Mes lots | Risque | Mitigation |
|---|---|---|---|
| `docs/architecture.md` | 1 (§12.3), 3 (paragraphe `app`) | Tous les epics y écrivent | Chaque lot ne touche qu'un titre ; rebase avant la PR |
| `skills/panneau-perso/SKILL.md` | 4 | La spec Skills 008 (jalon 2) l'édite aussi | Seule la section « Partage » est remplacée ; l'orchestrateur de Skills le sait (Q11) |
| `src/panels/api.ts`, `contract/api.ts` de l'`app` | 4 | Le jalon 2 de 008 crée `app.open`, `app.check` dans le même fichier | Le premier arrivé crée, l'autre ajoute |
| `src/panels/framework/`, chemin `addPanel` du runtime | 1 (FR-010) | Un epic qui touche les définitions de panneau, par exemple 005 (réglages des pratiques) | Une propriété de définition et son contrôle, rien d'autre ; sinon l'écart devient une issue (Q7) |
| `src/kernel/settings`, `src/runtime/daemon/compose/` | 4 (zone `cliApp`, câblage) | 005 ou 006 peuvent y ajouter des réglages ou des services | Une ligne par zone, rebase |
| `src/shells/desktop/main/webSecurity.ts` | 1 | Aucun autre epic connu | Aucune |
| `src/shells/desktop/ui/panels/app/*` | 5 | Aucun autre epic connu (le jalon 2 de 008 y touchera pour le pont) | Aucune |

## Ordre et parallélisme

```
lot 1 (écarts) ───────────────┐
lot 2 (paquet, export, stage) ┼─> lot 3 (accord, installation) ─┬─> lot 4 (CLI, skill)
                              │                                 └─> lot 5 (carte d'import)
                              └─────────────────────────────────────> lot 6 (recette, Heifara)
```

- Lots 1 et 2 ne partagent aucun fichier (sauf la ligne de réexport de `contract.ts` du lot 2) : ils partent ensemble.
- Le lot 3 dépend du lot 1 (il modifie `grant.ts` et `session.ts` que le lot 1 modifie aussi) et du lot 2 (il consomme `stage` et le registre).
- Les lots 4 et 5 ne partagent aucun fichier : ils partent ensemble après le lot 3.
- Le lot 6 passe après les lots 1, 3 et 5 pour l'écran ; la partie T028 du jalon 1 peut se faire après le lot 1 seul.
- Les lots « écarts » et « partage » partagent : `contract/grant.ts`, `session.ts`, `runtime/server.ts` (si le lot 3 touche la liste des en-têtes), `docs/architecture.md`.

## Tests

- Rouge d'abord, pour chaque lot (la liste est dans `tasks.md`). Tests purs pour `bundle.ts`, `grant.ts`, `manifest.ts`, la décision de requête ; tests runtime en dossier temporaire pour `export.ts`, `import.ts`, `scan.ts`, `session.ts` ; tests de vue en jsdom pour `ImportCard`.
- **Fixtures hostiles du lot 2** (au moins 12) : `..` ; chemin absolu ; `C:\` ; lien symbolique ; deux chemins à casse différente ; `cate-panel.json` absent ; `id` différent ; JSON invalide ; empreinte annoncée fausse ; 201 fichiers ; fichier de 2 Mio + 1 octet ; total de 10 Mio + 1 octet ; nom avec U+200B (13 cas ; `.env` et les secrets sont refusés à l'export, lot 2 T203).
- Aucun test ne lit ni n'écrit le vrai `~/.cate` ou `~/.claude` ; un test échoue s'il les voit.
- Aucun e2e exécuté ; un parcours Playwright de l'import peut être écrit et non lancé (rapport : « non exécuté »).

## Code mort à supprimer

- La phrase « sans accès à vos fichiers » et son test (lot 1).
- La section « Partage » du skill qui décrit la copie à la main (lot 4).
- `source: 'local'` codé en dur dans `scan.ts` (lot 3).
- Rien d'autre : le champ `AppGrant.source: 'installed'` et `folderFingerprint` existent et servent enfin.

## Risques

- **WebRTC et préchargements non prouvés par un test** : seul l'écran de Heifara le prouve ; le lot 6 le dit et le lot 1 ne se déclare pas « vérifié en conditions réelles ».
- **FR-010 plus grand que prévu** : voir Q7.
- **Les plafonds** (10 Mio, 200 fichiers) peuvent être trop bas pour un panneau avec une bibliothèque lourde (une bibliothèque minifiée comme SheetJS est de l'ordre du Mio, non mesuré ici) : valeurs de départ, ajustables.
- **JSON contre zip** : si Skills exige un zip, c'est un lot supplémentaire (une dépendance ou un lecteur de zip à écrire) ; non chiffré.
