---

description: "Tâches : coût en jetons de l'attente d'un orchestrateur (issue #100)"
---

# Tasks: Coût en jetons de l'attente d'un orchestrateur

**Input**: `specs/006-cout-attente-orchestrateur/` (spec.md, plan.md, mesure.md)

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée dans le rapport).

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate` ou `~/.claude`, relancer des tests sans édition depuis leur dernière exécution verte, merge, push sur `main`, force-push. Les sondes du lot 2 utilisent des agents jetables dans l'app déjà ouverte (`cate agent start`), jamais un second lancement de l'app.

**État** : spec écrite, aucune tâche commencée. Aucune décision de Heifara n'est attendue avant les lots 1 et 2 (Q1 à Q6 ont une hypothèse de travail).

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US3]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : sonnet pour le lot 1, haiku pour les agents jetables du lot 2, sonnet pour le lot 3, sonnet pour le lot 4.
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur.
- Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).

## Vue d'ensemble

| Lot | But | Durée | Fichiers | Dépend de | Parallèle avec |
|---|---|---|---|---|---|
| 1 | Mesure de base : le script et son nombre de départ | 1 j | `tools/agence/attente_mesure.py`, `tools/agence/test_attente_mesure.py`, `tools/agence/fixtures/attente/*` | rien | 2 |
| 2 | Piste retenue : sonde du mécanisme (fin de tour, filet en fond) sur des agents jetables | 0,5 j | `specs/006-cout-attente-orchestrateur/rapport-sonde.md` | rien | 1 |
| 3 | Écriture de la règle dans le skill, garde de texte | 0,5 j | `skills/orchestrateur/SKILL.md`, `tools/agence/test_regle_attente.py` | 2 | 1 (autre fichier) |
| 4 | Mesure après : une vague réelle, comparaison, décision sur la piste 4 | 0,5 j + une vague réelle | `specs/006-cout-attente-orchestrateur/rapport-mesure.md` | 1 et 3 mergés et installés | aucun |

Lots 1 et 2 ne partagent aucun fichier : ils partent ensemble. Le lot 3 ne touche aucun fichier du lot 1 : il peut partir dès que le lot 2 est lu. Le lot 4 attend les deux et une vague réelle (calendrier, pas d'effort).

## Lot 1 : mesure de base (1 j, FR-005, FR-006)

**But** : le nombre de départ, reproductible par n'importe qui sur ses propres journaux. Indicateurs : I1 à I4 de `mesure.md`.

### Tests d'abord (à voir rouges)

- [ ] T001 [P] [US3] Fixture `tools/agence/fixtures/attente/journal.jsonl` : 7 tours de `assistant` avec `usage` (dont un message écrit sur deux lignes de même `message.id`), 2 tours qui suivent un appel Bash contenant `agent wait`, 1 tour qui suit un `Stop hook feedback`, 4 tours qui suivent un `tool_result`. Fichier `attendu.json` à côté : tours = 7, passages d'attente = 2, tours Stop hook = 1, jetons lus par cause, médiane du contexte. Les nombres s'écrivent à la main avant le script.
- [ ] T002 [P] [US3] `tools/agence/test_attente_mesure.py` : (a) la sortie du script sur la fixture égale `attendu.json` ; (b) la sortie ne contient aucune chaîne du texte de la fixture (jeton marqueur placé dans un message) ; (c) un `agentId` autre que `claude-code` rend « non mesuré » et le code 0 ; (d) un journal absent est compté et nommé par un nombre, jamais par son chemin ; (e) deux lancements donnent la même sortie ; (f) un chemin hors du dossier de sessions est refusé ; (g) le journal lu n'est pas modifié (empreinte avant et après). Résultat attendu : rouge, module absent.

### Code

- [ ] T003 [US3] `tools/agence/attente_mesure.py` (nouveau, Python 3.9, bibliothèque standard, `python3 -I`) : lit les journaux d'un dossier de sessions et d'une liste d'ids, applique la méthode de `mesure.md` (dédoublonnage par `message.id`, cause du tour, passage d'attente), rend I1 à I4, le nombre d'appels `agent wait` par valeur de `--wait-timeout`, la durée des attentes et les passages par 10 min. Texte et JSON (`--json`). Aucune écriture, aucun réseau.
- [ ] T004 [US3] Reproduire `mesure.md` : lancer le script sur les 10 journaux de l'échantillon (lecture seule, chemin passé en argument) et reporter dans `rapport-mesure.md` (section « Avant ») les nombres obtenus à côté de ceux de `mesure.md`. Attendu : 1 730 tours, 442 732 472 jetons lus (SC-005). Un écart est expliqué ou la définition corrigée.

**Test d'acceptation** : `npm run test:agence` vert pour les tests du lot ; T004 reproduit `mesure.md`. **Indicateur** : I1 à I4 « avant » écrits, avec la date et le nombre de sessions lues.

**Fichiers touchés** : `tools/agence/attente_mesure.py`, `tools/agence/test_attente_mesure.py`, `tools/agence/fixtures/attente/journal.jsonl`, `tools/agence/fixtures/attente/attendu.json`, `specs/006-cout-attente-orchestrateur/rapport-mesure.md` (section « Avant »).

**Dépend de** : rien. **Parallélisable avec** : lot 2 (aucun fichier commun), lot 3 (autres fichiers).

## Lot 2 : piste retenue, sonde du mécanisme (0,5 j, FR-001, FR-002, hypothèses de la spec)

**But** : vérifier dans l'app, avec des agents jetables, ce que la spec n'a pu que lire : (1) une session qui finit son tour est réveillée par un `cate agent send` sans tour intermédiaire ; (2) un `cate agent wait` en fond la réveille une fois à sa sortie ; (3) la commande ne sort pas tout de suite quand les agents viennent d'être lancés ; (4) un Stop hook de `/goal` annule (1) et (2) comme la mesure le suggère.

- [ ] T010 [P] [US1] Sonde A (agent jetable, modèle le moins cher, titre `#n497 sonde`, un seul à la fois) : un « orchestrateur de sonde » lance un agent B jetable (« attends 90 s puis envoie `ok` par `cate agent send` à ton parent ») et termine son tour sans rien d'autre. Relever par `cate agent usage` (jetons d'entrée avant et après) et `cate agent list` : nombre de tours de l'orchestrateur de sonde pendant les 90 s (attendu : 0), et son réveil à l'arrivée de `ok` (attendu : 1 tour).
- [ ] T011 [P] [US1] Sonde B : même montage, mais l'orchestrateur de sonde lance `cate agent wait <B> --wait-timeout 600000` en tâche de fond et termine son tour. Relever : réveil à la sortie (attendu : 1), sortie immédiate ou non quand B vient d'être lancé (attendu : non, après la fin de B), passages entre-temps (attendu : 0).
- [ ] T012 [US2] Sonde C : même montage que A, avec un `/goal` dont la condition est fausse. Relever le nombre de tours forcés pendant 90 s (attendu : au moins 1 par fin de tour). Fermer les panneaux jetables ensuite (`cate panel close`, sans `--discard` sauf refus sur un panneau jetable).
- [ ] T013 [US1] `specs/006-cout-attente-orchestrateur/rapport-sonde.md` : une ligne par sonde (montage, nombre mesuré, attendu, écart). Une hypothèse de la spec qui tombe est dite et le plan corrigé (Q3, mécanisme du filet) avant le lot 3.

**Test d'acceptation** : les trois sondes ont un nombre mesuré écrit ; 0 panneau jetable restant ; pas de plus de 4 agents Claude vivants à la fois (mémoire du projet : plafond du Mac).

**Indicateur** : tours de l'orchestrateur de sonde par 90 s d'attente : 0 pour A et B, au moins 1 pour C.

**Fichiers touchés** : `specs/006-cout-attente-orchestrateur/rapport-sonde.md` seulement.

**Dépend de** : rien. **Parallélisable avec** : lot 1. **Coût** : non chiffré ; 3 agents jetables à la fois au plus, modèle le moins cher.

## Lot 3 : écriture de la règle dans le skill (0,5 j, FR-001 à FR-004, FR-009)

**But** : la règle, sans valeur propre à un dev, en quelques lignes. Écrire seulement ce que le lot 2 a confirmé.

### Tests d'abord (à voir rouges)

- [ ] T020 [P] [US1] `tools/agence/test_regle_attente.py` : lit `skills/orchestrateur/SKILL.md` et vérifie (a) aucune occurrence de `--wait-timeout 60000` ; (b) le filet : `--wait-timeout 600000` et `run_in_background` ; (c) la règle de fin de tour (la phrase sur les rapports par `cate agent send`) ; (d) la règle `/goal` ; (e) aucune valeur propre à un dev (nom, chemin personnel, modèle imposé) ; (f) le skill pèse au plus 105 % de 13 936 octets. Résultat attendu : rouge sur le skill actuel (il contient `--wait-timeout 60000`, `SKILL.md:28`).

### Code

- [ ] T021 [US1][US2] `skills/orchestrateur/SKILL.md` : remplacer la ligne 28 (étape 5, « Suis ») par la règle du plan (fin de tour, filet en fond, `cate agent list` puis `cate agent read` au réveil) ; ajouter la règle `/goal` (deux lignes dans la liste de ce qui ne se fait pas, ou sous « Pour chaque tâche ») ; ajouter une ligne de mesure vers `attente_mesure.py` (FR-005). Ne pas toucher aux autres lignes : le fichier est aussi l'objet des specs 002 et 005.
- [ ] T022 [US1] Chercher les autres sources de la règle : `skills/cate-cli/references/agents.md:15` (« repeat while it exits 1 ») dit déjà la commande, pas la politique ; la laisser (Q1) sauf décision contraire de Heifara. Dire le résultat dans la PR.

**Test d'acceptation** : `test_regle_attente.py` vu rouge puis vert ; `git diff --stat` ne montre que `SKILL.md` et le test (SC-004), 3 hunks au plus dans le skill.

**Indicateur** : taille du skill avant et après (13 936 octets avant ; au plus 14 632 après).

**Fichiers touchés** : `skills/orchestrateur/SKILL.md`, `tools/agence/test_regle_attente.py`.

**Dépend de** : lot 2 (rapport de sonde lu). **Parallélisable avec** : lot 1. **Conflit** : `SKILL.md` aussi visé par les specs 002 et 005 (plan, « Conflits de fichiers ») : rebaser sur `origin/main` juste avant la PR et dire dans la PR s'il y a eu un conflit.

## Lot 4 : mesure après (0,5 j + une vague réelle, FR-006, SC-001 à SC-003)

**But** : savoir si la règle a fait baisser les indicateurs, et décider de la suite.

- [ ] T030 [H] Heifara lance une vague réelle (au moins 3 agents, 10 min d'attente) avec le skill du lot 3 installé et sans `/goal` posé par l'orchestrateur. Aucune autre action de sa part ; la mesure vient des journaux.
- [ ] T031 [US3] Lancer `attente_mesure.py` sur les sessions de la vague et écrire dans `rapport-mesure.md` (section « Après ») I1 à I4 à côté de « Avant », avec la durée d'attente, le nombre de passages par 10 min (SC-001), I2 (SC-002) et I3 (SC-003). Dire si l'échantillon est trop petit.
- [ ] T032 [US1] Décision écrite : (a) SC-001 à SC-003 tenus : clore l'issue #100 (`Closes #100` sur la PR du lot 3, ou fermeture après le lot 4) ; (b) I3 reste haut : rouvrir Q5 (contrôle `/goal` par le régisseur, nouvelle spec) ; (c) I1 par 10 min reste haut : rouvrir la piste 4 (`agence wait`) comme une nouvelle spec, avec le nombre mesuré. Aucun correctif de code dans ce lot (FR-007).

**Test d'acceptation** : `rapport-mesure.md` contient « Avant » et « Après » avec les mêmes quatre indicateurs, la décision (a), (b) ou (c), et ce qui n'est pas mesuré.

**Indicateur** : SC-001 (≤ 1 passage d'attente par 10 min), SC-002 (≤ 2 %), SC-003 (0 tour Stop hook).

**Fichiers touchés** : `specs/006-cout-attente-orchestrateur/rapport-mesure.md`.

**Dépend de** : lots 1 et 3 mergés, runtime et skill installés (le skill se lit à chaque tour ; le runtime n'est pas concerné : `cate agent wait` à 600 s est déjà là). **Parallélisable avec** : aucun.

## Hors lots (pas planifiés)

- Piste 4 (`agence wait`) : seulement si le lot 4 conclut (c). Nouvelle spec.
- Contrôle `/goal` par le régisseur : seulement si le lot 4 conclut (b). Nouvelle spec.
- Compactage et `/clear` : spec 004, lots 2 et suivants.
- Réglage par dev du plafond et des seuils : spec 005.

## Dépendances et exécution

- Lots 1 et 2 : ensemble, deux implémenteurs, aucun fichier commun. Le lot 3 part quand le rapport de sonde est lu ; il tient dans un autre fichier que le lot 1, donc en parallèle de lui.
- Lot 4 : après merge des lots 1 et 3 et une vague réelle ; c'est du calendrier, pas de l'effort.
- Total d'effort : environ 2,5 jours d'implémenteur sur 4 lots, dont 0,5 jour de sondes ; hors attente d'une vague réelle.
