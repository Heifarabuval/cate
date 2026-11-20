# Implementation Plan: Apprentissage par observation

**Branch**: `docs/spec-apprentissage-observation` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: issue #76. Spec seule dans cette PR ; l'issue reste ouverte pour l'implémentation. Aucun code ici.

## Summary

Un nouveau module `workspace/observation` tient le journal local des gestes (un fichier `.jsonl` par jour, 14 jours), le détecteur de répétitions (3 fois en 14 jours, règle déterministe) et l'état d'accord. Les événements viennent de trois sources déjà dans le fork (document, navigateur, terminal) par des ports que le composition root remplit. Le panneau agence montre les cartes de proposition et l'écran d'accord ; le panneau navigateur porte le bouton d'enregistrement. `agence observe list` lit le journal.

Cinq lots, dans l'ordre de l'issue, sauf un échange (accord avant enregistrement, voir « Écart avec l'issue ») :

1. **Lot 1, journal du socle** : contrat pur et règles, journal, purge, garde d'accord, événements du document et de navigation, `agence observe list`. 3 j.
2. **Lot 2, détecteur et carte** : détection pure, état des propositions, carte dans le panneau agence. 2 j.
3. **Lot 4 (fait avant le 3), accord, pause, effacer** : écran d'accord, pause, « Tout effacer », tests de non-capture croisés. 2 j.
4. **Lot 3, enregistrement du navigateur** : bouton, pastille rouge, script de page, exclusions. 4 j.
5. **Lot 5, recette** : génération depuis une proposition ou un enregistrement, validation. 2 j.

Plus un **lot 0** de sondes (0,5 j) pour Q1 (commande de terminal) et pour l'injection du script de page, et la recette réelle (action de Heifara, aucune fenêtre lancée par un agent).

| Sujet | Recommandé | Taille | Coût mensuel |
|---|---|---|---|
| Où vit le module | `src/workspace/observation/` (contrat, runtime) ; vue dans le panneau agence | lots 1 et 2 | 0 € |
| Format du journal | JSONL par jour, une ligne `{ts, kind, panelType, ref}`, ajout seul | lot 1 | 0 € |
| Détecteur | suite normalisée comptée sur 14 jours, fonction pure, sans modèle | lot 2 | 0 € |
| Enregistrement | script injecté par le page driver, règles pures partagées, double filtre (page + runtime) | lot 3 | 0 € |
| Recette | gabarit déterministe, texte validé par clic | lot 5 | 0 € |
| Commande de terminal | hors du premier lot, sonde d'abord (Q1) | lot 0 | 0 € |

## Technical Context

**Language/Version**: TypeScript strict. Python 3.9+ stdlib pour `agence observe` (`tools/agence/`).

**Primary Dependencies**: aucune ajoutée. `kernel/state` pour `etat.json`, `defineSettings`, `defineCapability`, `defineCateApi` existants.

**Storage**: `~/.cate/workspaces/<runtimeId>/observations/<AAAA-MM-JJ>.jsonl` (ajout seul) et `observations/etat.json` (propositions, domaines muets) ; l'accord et la pause dans les réglages du workspace (`settings.json`, slice `observation`). Un seul écrivain : le runtime.

**Testing**: Vitest à côté du code (`*.test.ts` en node, `*.test.tsx` en jsdom pour le script de page) ; `unittest` pour `agence observe`. Tout test qui écrit des fichiers tourne dans un dossier temporaire et échoue s'il voit le vrai `~/.cate`. Tests de non-capture : un par ligne de la liste « jamais capté ». Aucun e2e Playwright, aucune fenêtre (constitution X) : la page de test est du jsdom ; la vérification réelle est une action de Heifara.

**Target Platform**: macOS Apple silicon (principe VIII).

**Project Type**: desktop-app (fork) + CLI embarquée.

**Constraints**: couches et côtés (`lint:deps`) ; un seul écrivain par fichier ; coupes nettes ; écart minimal avec upstream (principe IX) : le nouveau module et le panneau agence sont propres au fork ; les ajouts dans `panels/browser` et `services/browser` sont minces (un port, un bouton).

**Scale/Scope**: 1 utilisateur par poste ; quelques milliers de lignes par jour au plus.

## Constitution Check

| Principe | Vérification | État |
|---|---|---|
| I. Couches et côtés | `workspace/observation/{contract,runtime}` : les règles pures (masquage d'URL, champs sensibles, exclusions, suites) sont des contrats purs ; le journal et le détecteur sont côté `runtime/` ; la vue dans `shells/desktop/ui/panels/agence/` ; `services/*` (navigateur, terminal) appellent le port d'observation du `workspace` (couche plus basse, autorisé) ; le script de page est bundlé seul et n'importe que des contrats | OK, `lint:deps` à chaque lot |
| II. Déclarer une fois | capability `observation`, méthodes `cate.observe.*` (`defineCateApi`), slice de réglages (`defineSettings`), actions « Pause l'observation » et « Tout effacer » (`defineActions`) ; aucune liste à la main ; `agence observe` appelle la méthode déclarée | OK |
| III. Coupes nettes | aucun code de migration (module neuf), aucune ancienne forme lue | OK |
| IV. Pas de branchement sur le contexte | le runtime filtre ce qu'il reçoit, quel que soit le client ; l'enregistrement demande `clientHas('pageDriver')`, jamais « desktop » | OK |
| V. Le runtime est l'application | journal, purge, détecteur, accord et effacement côté runtime ; la vue affiche et envoie des ops ; l'état d'enregistrement est un enregistrement (jamais une commande) et l'arrêt est une op explicite | OK |
| VI. Tests d'abord | chaque tâche de code a sa tâche de test rouge avant (tasks.md) ; non-capture avant écriture | OK |
| VII. Le plus simple | JSONL et fonctions pures ; pas de base, pas de modèle, pas de file de messages | OK |
| VIII. macOS seul | aucun cas Linux ni Windows | OK |
| IX. Écart minimal avec upstream | nouveau module et agence propres au fork ; le bouton d'enregistrement passe par `definePanel` (`commands`/`chrome`), pas par un menu écrit à la main | OK, à relire au lot 3 |
| X. Aucune fenêtre lancée par un agent | aucun Electron, aucun Playwright ; script de page testé en jsdom ; X001 est une action de Heifara | OK |

## Couverture de la spec

| Exigence | Où | Test | Lot |
|---|---|---|---|
| FR-001, FR-009 | `src/workspace/observation/runtime/{journal,purge}.ts` | `journal.test.ts`, `purge.test.ts` (horloge simulée J-13, J-14, J-15) | 1 |
| FR-002 | `contract/rules.ts` (`stripUrl`, `redactCommand`), sources dans le composition root | `rules.test.ts`, `sources.test.ts` | 1 (document, navigation) ; terminal : lot 0 puis décision |
| FR-003, FR-004 | garde d'accord et de pause dans `journal.ts` | `journal.test.ts` (état neuf : 0 fichier) | 1 |
| FR-005 | bouton, pastille, script de page, ops `recording.start/stop` | `recorder.test.tsx` (jsdom), `session.test.ts` du navigateur | 3 |
| FR-006, FR-015 | `contract/rules.ts` (`isSensitiveField`, `isExcludedDomain`), appliqué par le script et par `record` du runtime | `nonCapture.test.ts` : une section par ligne de la liste | 1, 3, 4 |
| FR-007 | liste par défaut dans `contract/exclusions.ts`, ajouts dans les réglages | `exclusions.test.ts` (sous-domaines, retrait confirmé) | 1 puis 3 |
| FR-008 | `contract/rules.ts` (`redactCommand`) | `redact.test.ts` (corpus de lignes avec et sans secret) | 0 puis 1 si Q1 oui |
| FR-010, FR-011 | `contract/detect.ts`, `runtime/detector.ts`, carte dans `ui/panels/agence/` | `detect.test.ts`, `session.test.ts` (ops), `PropositionCard.test.tsx` | 2 |
| FR-012 | `runtime/erase.ts`, op `observation.erase`, `agence observe erase` | `erase.test.ts`, `test_observe.py` | 4 |
| FR-013, FR-014 | `contract/recipe.ts` (gabarit) | `recipe.test.ts` (aucune valeur de champ) | 5 |
| FR-016 | `cate.observe.list/erase` dans `contract/api.ts`, `agence observe` | `engine.test.ts` (aide générée), `test_observe.py` | 1, 4 |
| FR-017 | liste de refus du pont 008 (D7) | test de la spec 008 (`observations/`) ; ici : le dossier est hors racine | au moment de 008 |
| FR-018 | aucun import réseau dans `workspace/observation` | règle `lint:deps` (pas de `ws`, `fetch`) + `network.test.ts` (grep) | 1 |
| FR-019 | `package.json` inchangé | revue du diff | chaque lot |
| FR-020 | `npm run lint:deps` | CI | chaque lot |

## Project Structure

### Documentation

```text
specs/003-apprentissage-observation/
├── spec.md
├── plan.md        # ce fichier
└── tasks.md
```

`research.md`, `data-model.md` et `contracts/` ne sont pas créés ici : le modèle de données tient dans spec.md (Key Entities) et le contrat dans la section suivante. Ils se créent au lot 1 si le contrat grossit.

### Contrat (esquisse, à confirmer au lot 1)

```text
Observation   { ts: ISO 8601, kind, panelType, ref }                   une ligne JSONL
kind          panel.created | panel.closed | panel.linked | navigate
              | terminal.command (sous Q1) | click | field
Capability observation
  state()                       -> { accord, pause, propositions[], domainesMuets[], recording }
  record(batch[])               -> client vers runtime ; schéma validé, filtre appliqué, taille bornée
  grant() / revoke()            -> accord (avec « Tout effacer » sur retrait)
  pause(on) / erase(confirm)    -> op explicites
  answer(propositionId, choix)  -> oui | pas-utile | domaine-muet
Cate API      cate.observe.list (read), cate.observe.erase (control)    gardés par un réglage cliObservationEnabled, coupé par défaut
agence        agence observe list [--jours N] [--refs] [--json]  /  agence observe erase
              (par défaut le décompte par type, sans ref ; --refs : une ligne par observation, avec un avertissement, car un terminal enregistre sa sortie dans terminal-logs/)
Réglages      observation { accord: {donneLe}|null, pause: bool, exclusionsAjoutees[], exclusionsRetirees[] }
Fichiers      observations/<AAAA-MM-JJ>.jsonl   (0600)   observations/etat.json   (propositions, domainesMuets)
```

### Source Code (à écrire)

```text
src/workspace/observation/
├── contract.ts
├── contract/
│   ├── rules.ts           # stripUrl, redactCommand, isSensitiveField, isExcludedDomain (pur)
│   ├── exclusions.ts      # catégories par défaut (banque, mail, santé, RH, paie)
│   ├── detect.ts          # suites, fenêtre de 14 jours (pur)
│   ├── recipe.ts          # gabarit déterministe (pur)
│   ├── capability.ts      # defineCapability
│   ├── api.ts             # defineCateApi (cate.observe.*)
│   └── settings.ts        # defineSettings (slice observation)
└── runtime/
    ├── index.ts           # createObservationRuntime(deps), observationCapabilityImpl
    ├── journal.ts         # ajout seul, fichier du jour, 0600, garde d'accord et de pause
    ├── purge.ts
    ├── detector.ts
    └── erase.ts
src/panels/agence/                       # panneau propre au fork
├── contract/types.ts      # + propositions, accord, pause dans l'instantané ; + ops
├── session.ts             # + ops observation.* et answer
src/panels/browser/ , src/services/browser/desktop/    # lot 3 : op recording, script de page, pastille
src/shells/desktop/ui/panels/agence/     # lots 2 et 4 : PropositionCard, AccordObservation, bandeau pause
src/shells/desktop/ui/panels/browser/    # lot 3 : bouton et pastille
src/runtime/daemon/compose/              # câblage des sources (document, navigation, terminal)
tools/agence/agence.py                   # observe list, observe erase ; test_observe.py
docs/architecture.md                     # 7.2 (observations/), 9.x ou 10.x (module), liste des modules
```

**Structure Decision**: un module de la couche `workspace` (les observations sont des données du workspace) ; le panneau agence et le panneau navigateur ne font que montrer et envoyer des ops. Les services qui produisent des événements n'importent que le contrat du module (port `observe(event)`), jamais son runtime.

## Lots (une PR chacun sur le fork, livrable seule)

| Lot | Contenu | Taille | Dépend de | Preuve |
|---|---|---|---|---|
| 0. Sondes | (a) lire la ligne soumise d'un terminal sans capter de frappes (hook de shell) ; (b) un script de page injecté par le page driver sans toucher à la page ; (c) lire `autocomplete` et `type` sur l'élément réel | 0,5 j | rien | note de 1 page ; décision Q1 ; tests jetables jsdom, aucune fenêtre |
| 1. Journal du socle | contrat, règles pures, journal, purge, garde d'accord (réglage), événements document et navigation, `agence observe list` | 3 j | 0 pour Q1 seulement | tests de non-capture des règles ; purge sur horloge simulée ; état neuf : 0 fichier ; `lint:deps` vert |
| 2. Détecteur et carte | `detect.ts`, état des propositions, carte et trois actions dans le panneau agence | 2 j | 1 | cartes attendues sur le journal fixture (0, 1, 0) ; une carte refusée ne revient pas |
| 4. Accord, pause, effacer | écran d'accord, pause, « Tout effacer », `agence observe erase`, tests de non-capture croisés | 2 j | 1 | état neuf puis accord puis pause puis effacer, tous testés ; grep des valeurs d'entrée dans tous les fichiers |
| 3. Enregistrement | bouton, pastille rouge, script de page, exclusions, arrêt à la fermeture | 4 j | 1, 4 | `recorder.test.tsx` : 0 valeur, 0 champ sensible ; X001 réel par Heifara |
| 5. Recette | gabarit, relecture, validation, destination (Q4) | 2 j | 2 ou 3 | `recipe.test.ts` ; aucun fichier écrit avant le clic |
| X. Recette réelle | parcours sur le vrai poste de Heifara : accord, enregistrement, carte, effacer | 0,5 j | 5 | action de Heifara, rapport |

Total estimé : 13,5 j d'agent plus 0,5 j de sondes, contre 13 j dans l'issue. Coût mensuel : 0 €. Les jours de l'issue sont des estimations ; aucun lot n'est lancé sans décision de Heifara. Deux implémenteurs en parallèle possibles après le lot 1 (2 et 4 touchent des fichiers différents du panneau agence : à coordonner sur `types.ts` et `session.ts`).

### Écart avec l'issue

- Le lot « écran d'accord, pause, Tout effacer » (issue : 4e case) passe avant l'enregistrement (3e case) : l'enregistrement capte des clics et des champs, il ne doit pas exister sans l'accord ni la pause. En contrepartie, le lot 1 livre un **garde d'accord** minimal (un réglage lu avant toute écriture, coupé par défaut) pour qu'aucune ligne ne soit jamais écrite sans accord, y compris avant l'écran.
- Les tests de non-capture sont écrits lot par lot (chaque règle a son test rouge avant son code), puis croisés au lot 4. L'issue les place en 4e case ; les écrire seulement là laisserait trois lots sans filet.

## Risques

| Risque | Effet | Parade |
|---|---|---|
| Une valeur de champ ou un secret passe dans le journal | fuite locale | règles pures partagées, double filtre, test qui cherche chaque valeur d'entrée dans tous les fichiers, écarter en cas de doute |
| Commande de terminal : aucune lecture propre sans frappes | événement impossible sans hook | lot 0 ; Q1 ; sans solution propre, retirer l'événement de l'issue |
| Le script de page change le comportement du site ou se voit | casse d'une page, détection | monde isolé du page driver, écouteurs passifs, aucun style injecté sauf la pastille du panneau (côté Cate, pas dans la page) ; sonde du lot 0 |
| La pastille rouge ment (script resté actif) | capture non voulue | test d'arrêt (fermeture du panneau, changement de page exclue, pause, sortie de l'app) ; le runtime ignore tout événement hors enregistrement actif |
| Le runtime fait confiance au client | écriture de fausses observations (M2) | validation de schéma, borne de taille, `kind` connu, rejet hors enregistrement, filtre du runtime refait |
| Un agent lit le journal par la CLI | le journal part chez un modèle (FR-018) | `cate.observe.list` derrière un réglage `cliObservationEnabled`, coupé par défaut, comme `cliTerminalInputEnabled` |
| Suites trop générales | propositions en boucle | seuil, longueur minimale, « Pas utile », domaines muets ; mesure sur le journal réel de Heifara avant d'ouvrir à un autre |
| Usage par un collègue sans cadre RGPD | risque juridique | aucune bascule « autres personnes » ; le dire dans l'écran d'accord ; décision de la DG avant (hors de cette spec) |
| Coût des écritures sur le chemin critique | lenteur à la création de panneau | écriture asynchrone non bloquante (file mémoire bornée, vidage groupé) ; mesure au lot 1 (SC-007) |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple rejetée |
|---|---|---|
| Règles pures dupliquées à l'exécution (page et runtime) | la page ne doit rien envoyer de sensible, et le runtime ne doit pas faire confiance à un client distant (D3) | filtrer seulement côté page : un autre appareil pourrait envoyer n'importe quoi |
| Garde d'accord dès le lot 1 | rien n'est écrit sans accord, avant même l'écran | écran d'accord au lot 4 seulement : trois lots écriraient sans accord |
| Un module `workspace` neuf | contrat, runtime, API, réglages, tous séparés par côtés | tout dans le panneau agence : le journal servirait un seul panneau et mélangerait couches |
| `agence observe` appelle la méthode `cate.observe.*` plutôt que de lire les fichiers | une seule déclaration de la lecture, gardée par les réglages CLI | lecture directe des fichiers par Python : contourne le réglage `cliObservationEnabled` |

## Tranché par Heifara

Rien n'est tranché au-delà du texte de l'issue #76. Les questions en attente sont dans spec.md (« Questions ouvertes », Q1 à Q9) ; trois sont posées dans le panneau agence (q409, q411, q413).
