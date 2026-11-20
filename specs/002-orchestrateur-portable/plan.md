# Implementation Plan: Orchestrateur portable

**Branch**: `docs/specs-002-orchestrateur-portable` | **Date**: 2026-11-19, mise à jour 2026-11-20 (branche `docs/spec-002-lots-macro`) | **Spec**: [spec.md](spec.md)

**Input**: spec rapatriée de Skills (`specs/006-orchestrateur-portable`, `1577235`), issue #29. Replanification des lots ouverts après les PR #27, #30, #40, #41 et #58.

## Summary

Au 2026-11-20 (`origin/main` `455a23b2`), tout ce que Max doit recevoir est livré : la CLI `agence` sur le PATH de tout terminal (PR #30), le nom de l'humain en CLI et dans le panneau (PR #41, #63), le skill `orchestrateur` livré (PR #63), les gardes d'envoi, `doctor --prerequis` et la bannière (PR #65), l'amorçage complet avec gardes et `doctor` (PR #40, #68, #70), le daemon qui suit l'app (PR #27), la bascule de Skills (Skills#37) et le retrait de `guard` sans `--mode` (#96). Les lots 2 à 5 de la version du 2026-11-19 n'ont plus rien d'ouvert hormis la preuve.

Il reste quatre lots macro, sans code produit (détail : `tasks.md`, partie B) :

1. **Lot 5-A, parcours en faux HOME** : un test qui rejoue la ligne d'amorçage avec la vraie CLI (le test de l'amorçage actuel utilise un faux `agence`). 0,5 j.
2. **Lot 5-B, relecture finale** : `rapport-final.md`, `quickstart.md` à jour, preuve du PATH. 0,25 j.
3. **Lot 5-C, recette réelle de Max** : liste de commandes et de résultats attendus, exécutée par Max, relevée en lecture seule. 0,25 j d'agent.
4. **Lot 5-D, suites côté Skills** : `measure.py` et l'exception du DM de Heifara. 0,25 j dans Skills.

La sécurité ne dépend plus de l'ordre des lots : les gardes sont livrés. Ce qui n'est pas prouvé : l'amorçage sur un Mac vierge, le terminal restauré, la durée du premier build, le semis du skill sur un vrai dépôt.

| Sujet | Recommandé | Taille | Coût mensuel |
|---|---|---|---|
| Skill | skill livré du fork, semé comme `cate-cli` (R2) | 0,5 j | 0 € |
| Nom dans le panneau | `watch` écrit `st['humain']`, le panneau titre la section avec (R4) | 0,5 j | 0 € |
| Pages sous le panneau | `do_GET` 404 sous `--token-stdin` (R3) | 0,25 j | 0 € |
| Gardes | `agence hooks`, json stdlib, échec fermé pour l'envoi (R3) | 1,25 j | 0 € |
| Prérequis | `agence doctor --prerequis [--hors-cate]` (R11) | 0,5 j | 0 € |
| Amorçage complet | deux appels de plus dans `cate-fork-install.sh` (R10) | 0,75 j | 0 € |

## Technical Context

**Language/Version**: Python 3.9+ stdlib (`tools/agence/agence.py`) ; TypeScript strict (panneau agence) ; sh POSIX (`agence-hook`, scripts `cate-fork-*`).

**Primary Dependencies**: aucune ajoutée. `json`, `tempfile`, `os`, `subprocess` côté Python.

**Storage**: `state.json` (deux clés écrites par `watch` : `humain`, `garde`) ; `~/.claude/settings.json` de l'utilisateur, seulement sur sa commande (`agence hooks`), ou celle de l'amorçage qu'il a collé.

**Testing**: `unittest` dans `tools/agence/` (`npm run test:agence`, CI `agence (macos-latest)` sous 3.9) ; Vitest à côté du code du panneau et pour `scripts/cate-fork-install.test.mjs` ; tout test qui touche `~/.claude`, `~/.cate` ou `launchctl` tourne en faux HOME et échoue s'il voit le vrai.

**Target Platform**: macOS Apple silicon (principe VIII). Aucun cas Linux ni Windows.

**Project Type**: desktop-app (fork) + CLI embarquée.

**Constraints**: Cate n'écrit aucun fichier global de l'utilisateur ; un seul écrivain de `state.json` (la CLI) ; coupes nettes ; écart minimal avec upstream (principe IX) : `src/panels/agence/` et `tools/agence/` n'existent que dans le fork, donc aucun coût de rebase.

**Scale/Scope**: 2 utilisateurs (Heifara, Max).

## Constitution Check

*Avant la recherche, puis après la conception : même verdict.*

| Principe | Vérification | État |
|---|---|---|
| I. Couches et côtés | panneau : `contract/` pur (types, `suivi.ts`), `session.ts` côté runtime, vue sous `src/shells/desktop/ui/panels/agence/`. CLI et skill hors `src/`. `npm run lint:deps` à chaque lot | OK |
| II. Déclarer une fois | le skill passe par le mécanisme des skills livrés (`bundled.ts` lit `skills/`) ; aucune liste écrite à la main ; la CLI Python n'est pas une méthode `defineCateApi` (hors API, R1) | OK |
| III. Coupes nettes | noms de la PR #40 gardés, ceux de la spec Skills abandonnés ; `guard` sans `--mode` retiré par la PR #96 après la bascule de Skills (Skills#37) ; valeur `owner` gardée telle quelle, sans migration (q303) | OK |
| IV. Pas de branchement sur le contexte | aucun code partagé touché | OK |
| V. Le runtime est l'application | le panneau lit `humain` et `garde` dans l'état ; la vue ne fait qu'afficher | OK |
| VI. Tests d'abord | chaque tâche de code a sa tâche de test rouge avant | OK |
| VII. Le plus simple | json stdlib, scripts existants étendus, aucun service | OK |
| VIII. macOS seul | tâches « hors macOS » de la spec Skills retirées (`toast()`, branches POSIX) | OK |
| IX. Écart minimal avec upstream | `src/` touché seulement dans `src/panels/agence/` et sa vue, propres au fork ; `scripts/` et `tools/` hors `src/` | OK |
| X. Aucune fenêtre lancée par un agent | aucun test e2e lancé ; X003 est une action de Max | OK |

## Couverture de la spec

| Exigence | Où | Test | État |
|---|---|---|---|
| FR-001 | `tools/agence/`, `install.ts:93`, `cateCli.ts:81`, `cliEnv.ts:55`, `agence-files.mjs:9` | `cateCli.test.ts`, `cliEnv.test.ts`, `contract.test.ts`, `build-runtime-tarball.test.mjs`, `test_launcher.py` | livré, PR #30 |
| FR-002 | `skills/orchestrateur/SKILL.md`, liste `required` de `build-runtime-tarball.mjs:160` | `seed.test.ts`, `test_portable.py` | livré, PR #63 |
| FR-003 | `agence.py:80-96` ; panneau `suivi.ts`, `SuiviList.tsx:12` | `test_agence.py` classes `Nom`, `NomDansLesTextes` ; `SuiviList.test.tsx` | livré, PR #41 et #63 |
| FR-004 | `OWNER_HUMAIN` (`agence.py:71`), `suivi.ts:86-87` | `test_agence.py`, `suivi.test.ts` | livré (PR #41), clé gardée (q303) |
| FR-005 | `gh_repo()` inchangé | `test_portable.py` (grep `/Users/`) | livré, PR #63 |
| FR-006 | `toast()` (`agence.py:315-321`) | aucun (principe VIII) | satisfait |
| FR-007, FR-008 | `agence hooks`, `agence guard --mode`, `tools/agence/agence-hook` | `test_hooks.py`, `test_guard.py` en faux HOME | livré, PR #65 ; décisions `ask` en réel : lot 5-C |
| FR-009 | `agence doctor --prerequis [--hors-cate]` | `test_doctor.py` | livré, PR #65 et #68 |
| FR-010 | `watch` écrit `humain` et `garde` ; `types.ts`, `session.ts`, `AgenceView.tsx`, `SuiviList.tsx` | `session.test.ts`, `AgenceView.test.tsx`, `SuiviList.test.tsx` | livré, PR #63 et #65 |
| FR-011 | `scripts/cate-fork-update.sh`, `runtimeUpdate.ts:38-43` | `cate-fork-install.test.mjs` (43 tests), `runtimeUpdate.test.ts` | livré, PR #40 et #27 |
| FR-012 | revue du diff | `test_portable.py` | livré, PR #63 |
| FR-013 | `scripts/cate-fork-install.sh`, `scripts/cate-fork-uninstall.sh` | `cate-fork-install.test.mjs` (cas gardes et doctor), `test_quickstart.py` (lot 5-A) | livré, PR #40 et #68 ; vraie CLI : lot 5-A |

## Project Structure

### Documentation

```text
specs/002-orchestrateur-portable/
├── spec.md
├── plan.md            # ce fichier
├── research.md        # R1 à R11
├── data-model.md
├── quickstart.md      # parcours de Max, recette
├── rapport-lot0.md    # sondes du lot 0 (historique, Skills 78a8fd3)
├── contracts/
│   ├── cli-agence.md  # nom, doctor --prerequis, guard --mode, lanceurs
│   └── hooks.md       # agence hooks, entrées settings.json
├── fixtures/          # cas hostiles de settings.json (lot 0), copiés au lot 3
└── tasks.md
```

### Source Code (fork, livré ; reste le seul test du lot 5-A)

```text
tools/agence/
├── agence.py            # humain, garde, 404 sous --token-stdin, hooks, guard --mode, doctor --prerequis
├── agence-hook          # nouveau : lanceur des gardes
├── test_agence.py       # watch écrit humain et garde, 404
├── test_hooks.py        # nouveau, faux HOME
├── test_guard.py        # nouveau, exécute la commande réelle du hook
├── test_doctor.py       # nouveau
├── test_portable.py     # nouveau, pureté
├── test_quickstart.py   # lot 5-A, le seul fichier de code qui reste : l'amorçage rejoué avec la vraie CLI
└── fixtures/settings/   # depuis specs/002-orchestrateur-portable/fixtures/
skills/orchestrateur/SKILL.md          # nouveau, réécrit sans nom de personne
scripts/agence-files.mjs               # agence-hook dans AGENCE_REQUIRED
scripts/build-runtime-tarball.mjs      # skills/orchestrateur/SKILL.md dans required
scripts/cate-fork-install.sh           # gardes (sauf --sans-gardes) et doctor
scripts/cate-fork-uninstall.sh         # --gardes
scripts/cate-fork-install.md           # doc de la ligne
src/panels/agence/contract/{types,suivi}.ts
src/panels/agence/session.ts
src/shells/desktop/ui/panels/agence/{SuiviList,AgenceView}.tsx
docs/architecture.md                   # skills livrés, gardes
```

Dépôt Skills (lot 5, livré par Skills#37) : `common/tools/agence.py`, `test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`, `common/hooks/agence-guard.sh` supprimés ; `common/settings.base.json` remplacé ; `send-guard.sh` réduit à l'exception personnelle.

**Structure Decision**: rien de neuf dans `src/` hors du panneau agence, propre au fork. `tools/agence/` reste hors des couches et du build esbuild ; le tarball le copie comme `skills/`.

## Lots restants (une PR chacun, livrable seule)

| Lot | Contenu | Tâches | Taille | Dépend de | Preuve |
|---|---|---|---|---|---|
| 5-A. Parcours en faux HOME | `tools/agence/test_quickstart.py` : la ligne d'amorçage, les gardes, la désinstallation avec la vraie CLI | T047 | 0,5 j | rien | `npm run test:agence` vert ; rouge vu sur une copie du script sans `hooks install` |
| 5-B. Relecture finale | `rapport-final.md` (FR, SC, PATH L1-17), `quickstart.md` à jour | T048 | 0,25 j | 5-A pour FR-013 et SC-003 | chaque ligne avec une commande ou un chemin:ligne, ou « non vérifié » |
| 5-C. Recette réelle de Max | nom de Heifara (T014), liste P1 à P7 et R1 à R13 de `tasks.md`, relevé dans `rapport-final.md` | T014, T049 | 0,25 j d'agent, plus Max | 5-A et 5-B | relevé en lecture seule, SC-001 chiffré |
| 5-D. Suites côté Skills | `measure.py`, exception du DM de Heifara | T044, T050 | 0,25 j, dépôt Skills | rien | PR sur Skills, décision de Heifara |

Total restant : environ 1,25 j d'agent, dont 0,5 j dans le fork. 5-A et 5-B partent ensemble (aucun fichier commun) ; 5-C après les deux ; 5-D à tout moment. Coût mensuel : 0 €. Coût en jetons : non chiffré.

## Conflits de fichiers avec les autres epics

Les specs 003 (observation, lots 0 et 1 mergés), 004 (cercle vertueux, lot 2 mergé), 005 (pratiques réglables), 006 (coût et attente) et 007 (panneaux perso partagés) s'écrivent ou s'implémentent en parallèle. Les lots de cette spec écrivent trois fichiers seulement : `tools/agence/test_quickstart.py` (nouveau), `specs/002-orchestrateur-portable/rapport-final.md` (nouveau) et `specs/002-orchestrateur-portable/quickstart.md`. Aucun n'est touché par une autre epic. Le risque est dans ce que le test du lot 5-A **lit** :

**Ordre de merge et conflits entre les 4 specs** : voir `.cate/tmp/backlog/recoupement.md` (vague 1 : 005-L1, 007-L2, 002-5A, 006-L1).

| Fichier lu par le lot 5-A | Autre epic qui peut le changer | Effet | Règle |
|---|---|---|---|
| `scripts/cate-fork-install.sh`, `scripts/cate-fork-uninstall.sh` | 005 (valeurs par défaut des gardes, preset) | le résumé de 3 lignes, le code de sortie ou `--sans-gardes` changent : `test_quickstart.py` rouge | l'implémenteur de 005 lance `npm run test:agence` et met le test à jour dans sa PR |
| `tools/agence/agence.py` (`hooks`, `guard`, `doctor --prerequis`, `HOOK_ENTREES` :2501) | 004 (`agence.py`, `declencheurs.json`), 005 (gardes réglables), 006 | texte ou ordre des points de `doctor`, forme de `settings.json` | idem ; `test_hooks.py` et `test_guard.py` restent la référence du contrat |
| `tools/agence/fixtures/settings/` | 005 | fixtures de config de Max | ne pas modifier une fixture existante, en ajouter une |
| `specs/002-orchestrateur-portable/quickstart.md` | 005 (si un preset change la première minute de Max) | recette de 5-C périmée | 005 écrit dans son dossier et signale le changement à l'orchestrateur ; seul le lot 5-B édite `quickstart.md` |

`tools/agence/agence.py` est le fichier le plus disputé (002 livré, 003 `observe`, 004 déclencheurs, 005, 006) : aucun lot de cette spec ne l'édite. `docs/architecture.md` et `CLAUDE.md` non plus.

## Liens (pratiques de Heifara codées en dur, à traiter dans l'epic 005)

Notés ici, pas traités ici. L'epic « Pratiques réglables par dev » est `specs/005-pratiques-reglables/` (écrite en parallèle, absente de `origin/main` au 2026-11-20).

| Où | Ce qui est figé | Remarque |
|---|---|---|
| `tools/agence/agence.py:90`, `src/panels/agence/contract/suivi.ts:9` | valeur stockée `owner` = `heifara` | opaque, jamais affichée, décision q303 de Heifara ; 005 peut la revoir, elle n'est pas un bug |
| `skills/orchestrateur/SKILL.md:43`, `:65` | « jamais de merge, push sur `main`, force-push, suppression de branche » ; seule exception `--force-with-lease` sur la branche d'une PR | qui merge et le flux de branches sont des réglages de dev |
| `skills/orchestrateur/SKILL.md:25` | `--new-worktree` pour tout agent qui modifie du code | worktree par agent : pratique de Heifara |
| `skills/orchestrateur/SKILL.md:19`, `:30` | test d'acceptation et condition de fin obligatoires, clôture avec preuve (`--evidence`) | TDD et preuve de fin à régler |
| `skills/orchestrateur/SKILL.md:34-41` | tout envoi en son nom passe par un brouillon cliqué ; merge au clic | « seul le clic envoie » reste non négociable côté sécurité, le périmètre des cibles peut se régler |
| `tools/agence/agence.py:2501` (`HOOK_ENTREES`) | le matcher d'envoi ne couvre que `slack_send_message`, `slack_schedule_message` et `Gmail__(send_message\|reply\|forward)` | un dev avec d'autres connecteurs n'a pas de garde dessus |
| `tools/agence/agence.py:668-700`, `spec.md` (Assumptions) | envoi Slack par le token utilisateur de Hermes (`~/.hermes/.env`) | Hermes est l'outil de Heifara ; sans lui, les brouillons `slack:` restent à valider |
| `tools/agence/agence.py:1919-1921` | `doctor --prerequis` exige `gh auth status` et `claude --version` | un dev sans GitHub ou sans issue obligatoire n'en a pas besoin |
| `skills/orchestrateur/SKILL.md` (kinds `issue`, `pr`) et `agence draft new --cible issue:\|pr:` | issue et PR comme sorties naturelles | issue obligatoire ou non : réglage |

Exclus : les URL `Heifarabuval/cate` (adresse du fork, SC-002).

## Risques

| Risque | Effet | Parade |
|---|---|---|
| Fusion de `settings.json` | config de Max écrasée | json stdlib, sauvegarde, idempotence testée, refus sur JSON invalide ou fichier non inscriptible, lien résolu, mode conservé (rapport du lot 0) |
| Deux jeux de gardes chez Heifara pendant la transition | double `ask`, ou `allow` de l'un ignoré | amorçage chez lui avec `--sans-gardes` jusqu'au lot 5 ; ordre du lot 5 : `agence hooks install` avant le retrait des anciens |
| Skill semé et skill utilisateur du même nom chez Heifara | mauvaise version chargée | L5-01 tranche la priorité avant le retrait du lien |
| `doctor` de la spec 001 et `doctor` des prérequis | contrat de la spec 001 cassé | option `--prerequis`, `doctor` seul inchangé (q305) |
| Amorçage qui touche `~/.claude` de Max | config d'un autre perdue | sauvegarde par `agence hooks install`, `--sans-gardes`, désinstallation `--gardes` |
| Premier build de 10 à 20 min (non mesuré) | Max croit à un blocage | journal et message d'avancement (livré, PR #40) ; mesure en X003 |
| Lecture de l'état d'un ancien régisseur | titre de section sans nom un tour | défaut « L'humain » tant que `humain` manque |

État au 2026-11-20 : levés par le lot 5 livré, les risques « deux jeux de gardes chez Heifara » et « skill semé contre skill utilisateur » (le skill et les gardes de Skills sont retirés). Ouverts : le premier build de 10 à 20 min (non mesuré, R3 du lot 5-C), l'amorçage chez Max sur un Mac vierge (R1 à R5), et l'effet de la garde sur les deux envois automatiques du DM de Heifara (T050, non vérifié en réel).

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple rejetée |
|---|---|---|
| Python dans un dépôt TypeScript | la CLI existe, testée (317 tests), stdlib | réécriture en TypeScript : plus de 5 j |
| Commande de hook en `sh -c` | trouver la CLI du runtime courant hors terminal Cate et échouer fermé pour l'envoi | chemin absolu d'un build : faux après chaque mise à jour |
| (retiré) `guard` sans `--mode` | gardé jusqu'à la bascule de Skills, retiré par la PR #96 (`7b41cd32`) | sans objet |
| Une clé `heifara` reste dans le code livré | ses états existants restent lisibles sans code de migration (SC-005, principe III) | passer à `humain` : réécriture par `load()`, donc de la migration (rejeté par Heifara, q303) |

## Tranché par Heifara le 2026-11-19 et le 2026-11-20

- q303 (besoin n304) : la valeur stockée `owner` reste `heifara`, opaque.
- q305 (besoin n306) : `agence doctor --prerequis` ; `doctor` seul inchangé.
- q307 (besoin n308) : `cliTerminalInputEnabled` reste coupé par défaut ; `doctor --prerequis` le nomme.
- q508 (2026-11-20) : le message « Ta journée » (DM de Heifara) passe par Hermes, T050 est tranchée ; le changement est côté dépôt Skills (`pro/tools/slack-moi.sh`, assistant de 8 h 30), à faire avant lundi 2026-11-23 (T050). Rien à changer dans le fork.

## Questions ouvertes (hypothèse de travail pour chacune)

- **Nom de Heifara (T014)** : `agence nom` rend aujourd'hui « Heifarabuval (git user.name) ». Hypothèse : il règle `agence.nom` avant d'envoyer la ligne à Max.
- **Où vit le test de l'amorçage avec la vraie CLI** : hypothèse, en Python (`tools/agence/test_quickstart.py`, job CI `agence (macos-latest)`), pas dans `scripts/cate-fork-install.test.mjs`, pour ne pas partager un fichier avec les epics qui touchent `scripts/`. À confirmer par l'orchestrateur.
- **R12 (deuxième passage de Max)** exige un commit sur `origin/main` du fork. Hypothèse : Heifara le pousse (commit docs anodin) ; aucun agent ne pousse.
- **Disponibilité de Max** pour 5-C : inconnue. Hypothèse : après les PR de 5-A et 5-B.
- **Changements hors de ce dossier** : aucun demandé par cette spec. La section « Liens » renvoie à 005 ; le skill `orchestrateur` du fork n'est pas modifié ici.
