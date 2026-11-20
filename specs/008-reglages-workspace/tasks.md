---

description: "Tâches : réglages par workspace, pour tous, dans l'interface (spec 008)"
---

# Tasks: Réglages par workspace, pour tous, dans l'interface

**Input**: `specs/008-reglages-workspace/` (spec.md, plan.md, inventaire.md)

**Prerequisites**: 005-L1 mergé (fait) ; 005-L2 mergé avant le lot 1 ; 005-L3 mergé avant le lot 1 (même `pratiques.py`) ; 005-L5 mergé avant le lot 3. Tests demandés : principe VI, chaque test vu **rouge** pour la bonne raison (sortie citée) avant le code. Tests en faux HOME et dossier temporaire.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, lancer `agence hooks`, relancer des tests sans édition depuis leur dernière exécution verte.

**État** : spec écrite, aucune tâche commencée. Q1 à Q9 ouvertes avec hypothèse ; aucune ne bloque le lot 1.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable. **[US1] à [US4]** : récit de la spec. **[H]** : action de Heifara.
- **Modèle** conseillé : haiku (mécanique), sonnet (courant), opus (écriture concurrente, couche ponctuelle, lancement différé).
- Un implémenteur par lot, un worktree par agent. Portes de chaque PR : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`. La PR dit ce qu'elle supprime et l'écart avec upstream (SC-007).

## Lots, vue d'ensemble

| Lot | Récits | Taille | Dépend de | Parallélisable avec |
|---|---|---|---|---|
| **1. Schéma pour tous, champs publiés, écriture par le régisseur** | US1, US2 | 1 j | 005-L2, 005-L3 ; 005-L4 et 004 pour `declencheurs.json` | aucun lot de 008 |
| **2. Options ponctuelles et nouveaux réglages branchés** | US4 | 1 j | 1 ; 006-L3 et 005-L4 pour `SKILL.md` | 3 (aucun fichier commun) |
| **3. Formulaire du panneau** | US1, US2 | 1,25 j | 1 ; 005-L5 mergé | 2 |
| **4. Premières questions** | US3 | 0,75 j | 3 | 2 |

Ordre : 1, puis {2} et {3} ensemble, puis 4. Total : 4 j d'agent. Estimation en jetons ou en euros : non chiffrée (aucune mesure).

---

## Lot 1 : schéma pour tous, champs publiés, écriture par le régisseur (US1, US2)

**But** : la CLI sait décrire chaque réglage en mots simples, publie le formulaire prêt à rendre et accepte les écritures du panneau. Rien ne change encore à l'écran.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_reglages` vu rouge puis vert ; `npm run test:agence` vert ; en faux HOME, un tour de `watch` publie `st['pratiques']['champs']` avec 16 entrées, chacune avec `nom`, `explique`, `choix`, `defaut`, `valeur`, `origine` ; un `POST /pratiques/set` valide écrit le fichier du projet, un invalide rend 400 et une phrase qui contient le `nom` et pas la clé.

**Fichiers touchés** : `tools/agence/pratiques.json`, `tools/agence/pratiques.py`, `tools/agence/test_reglages.py` (nouveau), `tools/agence/test_pratiques.py` (presets sous `valeurs`, `dit` retiré), `tools/agence/agence.py` (`un_tour`, `click`, `CHAMPS_TABLE`), `tools/agence/declencheurs.json` (`nom`), `tools/agence/test_declencheurs.py` (champ `nom`).

**Dépend de** : 005-L2 et 005-L3 mergés (`agence.py`, `pratiques.py`) ; pour `declencheurs.json`, 005-L4 et les lots ouverts de 004 (sinon T008 leur passe). **Parallélisable avec** : aucun lot de 008.

### Tests d'abord

- [ ] T001 [P] [US1] `tools/agence/test_reglages.py` : **schéma complet** (FR-001, FR-002) : chaque clé a `nom`, `explique`, `groupe`, `portee` ; chaque valeur permise (`valeurs`, `liste`) a un libellé dans `choix` ; chaque `essentiel` a une `question` ; 3 à 5 clés portent `question` ; chaque preset a `nom`, `explique`, `valeurs` ; les 4 nouvelles clés existent avec leurs défauts de l'inventaire ; chaque cohérence a une `phrase`. Modèle : haiku.
- [ ] T002 [P] [US1] `tools/agence/test_reglages.py` : **champs** (FR-003, SC-003) : `pratiques.champs` rend les 16 clés dans l'ordre du schéma ; pour chaque clé, `valeur` et `origine` égales à `show --json` ; origine `défaut`, `dev`, `projet`, `ponctuel` selon la couche ; `projet` faux sans fichier, vrai avec `{}` ; `nbProjet` compte les clés posées ; invariants rendus avec le nom de l'humain. Modèle : sonnet.
- [ ] T003 [P] [US1] `tools/agence/test_reglages.py` : **phrases humaines** (FR-005, SC-005) : pour chaque clé, une valeur hors liste donne un message qui contient son `nom` et ne contient ni la clé pointée ni un chemin de fichier ; les deux cohérences rendent leur `phrase` ; la CLI `agence pratiques set` garde la clé dans son message (dev) et ajoute la phrase. Modèle : sonnet.
- [ ] T004 [P] [US2] `tools/agence/test_reglages.py` : **routes du régisseur** (FR-004) : `click('/pratiques/set', ...)` écrit le fichier du projet ; une clé de portée `dev` écrit le fichier du dev ; plusieurs paires en un POST : une seule écriture, toutes ou aucune ; `/pratiques/unset` ; `/pratiques/preset` avec et sans `remplacer=1` (avec : le fichier ne garde que `preset`) ; refus : code 400 et phrase. Modèle : opus.
- [ ] T005 [P] [US1] `tools/agence/test_pratiques.py` : mise à jour des tests de 005 pour les presets sous `valeurs` et `explique` à la place de `dit` ; aucune assertion de 005 supprimée sans équivalent. Modèle : haiku.
- [ ] T006 [P] `tools/agence/test_declencheurs.py` : chaque ligne de la table a un `nom` non vide ; `nom` est dans `CHAMPS_TABLE`. Modèle : haiku.

### Implémentation

- [ ] T007 [US1] `tools/agence/pratiques.json` : libellés, `groupe`, `portee`, `question` (Q7 : `livraison.mode`, `tests`, `verification`, `agents.max`), 4 clés, presets sous `valeurs` avec `nom` et `explique`, `phrase` des cohérences. Textes sans jargon (ni clé, ni nom de commande ; `PR` seulement dans le nom du preset). Rend T001 vert. Modèle : sonnet.
- [ ] T008 [P] `tools/agence/declencheurs.json` (`nom` par ligne) et `tools/agence/agence.py` (`CHAMPS_TABLE`, `:2047`). Rend T006 vert. Modèle : haiku.
- [ ] T009 [US1] `tools/agence/pratiques.py` : `champs(sch, pol)`, phrases humaines dans `Invalide` (attribut `phrase`), lecture des presets sous `valeurs`, `poser_preset(..., remplacer=False)`, `regler_plusieurs(...)` en un seul `_modifier`. Rend T002, T003, T005 verts. Modèle : sonnet.
- [ ] T010 [US1] `tools/agence/agence.py` : `un_tour` publie `champs`, `presets`, `projet`, `nbProjet`, `invariants` ; `click` route `/pratiques/(set|unset|preset)` ; `agence pratiques preset --remplacer`. Moins de 150 lignes. Taille de `state.json` avant et après citée dans la PR. Rend T004 vert. Modèle : opus.
- [ ] T011 Portes et PR du lot 1. Corps : `Réf. #<issue de l'epic>`, ce qui est supprimé (`dit`, presets plats), « aucun changement visible : le panneau ne lit pas encore les champs ». Modèle : haiku.

**Checkpoint lot 1** : `agence pratiques show --json` et `st['pratiques']['champs']` disent la même chose ; un POST du régisseur écrit, un POST invalide refuse en mots simples.

---

## Lot 2 : options ponctuelles et nouveaux réglages branchés (US4)

**But** : `agence start` ne règle plus rien durablement ; notifications, rappel, modèle et effort suivent le workspace.

**Tests d'acceptation** : `test_reglages.py` (classe `Ponctuel`) vu rouge puis vert ; scénarios US4 1 à 4 en faux HOME ; `grep -nE "maxAgents|st\['notify'\]|RAPPEL" tools/agence/agence.py` : 0 ligne.

**Fichiers touchés** : `tools/agence/pratiques.py` (`charger(..., ponctuel)`), `tools/agence/agence.py` (`cmd_start`, `plafond`, notifications `:1616-1619`, `empty()`, `need add`, `need show`, `cmd_pratiques` et routes `set` qui retirent le ponctuel), `tools/agence/test_reglages.py`, `tools/agence/test_retrait.py` (test de `--max-agents` de 005-L2 remplacé), `tools/agence/test_agence.py` (usages de `notify`), `skills/orchestrateur/SKILL.md` (lignes 20, 24, 42).

**Dépend de** : lot 1 ; `SKILL.md` après 006-L3 et 005-L4. **Parallélisable avec** : lot 3.

### Tests d'abord

- [ ] T020 [P] [US4] `tools/agence/test_reglages.py` : **couche ponctuelle** (FR-009) : `start --max-agents 6` pose `st['ponctuel']['agents.max']`, fichier du projet inchangé (octets identiques) ; `plafond(st)` rend 6 ; `show` rend la source `ponctuel` ; `start` sans option vide la couche ; `--max-agents 40` refusé (code 2, phrase du schéma) ; un état ancien avec `maxAgents` ou `notify` est lu sans erreur, clés ignorées. Modèle : opus.
- [ ] T021 [P] [US4] `tools/agence/test_reglages.py` : **un réglage efface le ponctuel** (FR-010) : `agence pratiques set agents.max 3` et `POST /pratiques/set` retirent `agents.max` de `st['ponctuel']` et laissent les autres clés ponctuelles. Modèle : sonnet.
- [ ] T022 [P] [US4] `tools/agence/test_reglages.py` : **notifications** (FR-011) : `notifications.systeme: non` : aucun effet `toast` ; `--no-notify` ponctuel idem ; `notifications.rappel: 0` : aucun rappel ; 900 : rappel après 900 s et pas avant (horloge simulée). Modèle : sonnet.
- [ ] T023 [P] [US1] `tools/agence/test_reglages.py` : **modèle et effort par défaut** (FR-012) : `agents.modele: sonnet` et `need add` sans `--model` stocke `sonnet` avec l'origine `workspace` ; `--model opus` l'emporte ; `auto` ne stocke rien ; idem `agents.effort`. Modèle : sonnet.
- [ ] T024 [P] `tools/agence/test_politique_skill.py` (de 005-L4, sinon neuf) : `SKILL.md` ne contient plus « Au plus 4 agents » ni « après 5 min » ; il cite `agence pratiques show` pour le plafond et dit que `--max-agents` est ponctuel. Modèle : haiku.

### Implémentation

- [ ] T025 [US4] `tools/agence/pratiques.py` : `charger(racine, home, ponctuel=None)`, couche validée, source `ponctuel`. `tools/agence/agence.py` : `cmd_start` écrit `st['ponctuel']`, `plafond` et `un_tour` passent la couche, `empty()` perd `notify`, gagne `ponctuel: {}` ; `set` et les routes retirent la clé ponctuelle dans le même `tx()`. Rend T020 et T021 verts. Modèle : opus.
- [ ] T026 [US4] `tools/agence/agence.py` : notifications lues dans la politique, `RAPPEL` supprimé. Rend T022 vert. Modèle : sonnet.
- [ ] T027 [US1] `tools/agence/agence.py` : `need add` et `need show` (modèle et effort par défaut, origine). Rend T023 vert. Modèle : sonnet.
- [ ] T028 [P] `tools/agence/test_retrait.py`, `tools/agence/test_agence.py` : remplacer les tests qui attendent l'écriture de `agents.max` par `--max-agents` et `st['notify']`. Modèle : haiku.
- [ ] T029 [P] `skills/orchestrateur/SKILL.md` : lignes 20, 24 et 42 (inventaire, section 7). Rend T024 vert. Modèle : haiku.
- [ ] T030 Portes et PR du lot 2. Corps : code supprimé (`RAPPEL`, `st['notify']`, écriture de `agents.max` par `--max-agents`), phrase d'action : « un `--max-agents` passé hier ne vaut plus au prochain `agence start` : régler le plafond dans le panneau ou par `agence pratiques set agents.max N` ». Modèle : haiku.

**Checkpoint lot 2** : `agence start --max-agents 6` puis `agence start` : le plafond revient à celui du workspace, fichier inchangé.

---

## Lot 3 : formulaire du panneau (US1, US2)

**But** : une personne règle son workspace dans le panneau agence, sans terminal, sans JSON.

**Tests d'acceptation** : Vitest vu rouge puis vert : `session.test.ts`, `Reglages.test.tsx`, `AgenceView.test.tsx` ; `npm run typecheck`, `lint`, `lint:deps`, `test` verts ; e2e « non exécuté (constitution X) ».

**Fichiers touchés** : `src/panels/agence/contract/types.ts` (champs, presets, ops `pratique.*`), `src/panels/agence/session.ts`, `src/panels/agence/session.test.ts`, `src/panels/agence/contract/fixtures/etat.json`, `src/panels/agence/parts/runtime/pratiquesFile.ts` (supprimé), `src/panels/agence/runtime.ts` et `src/panels/runtime.ts` (dépendance `openEditor` retirée si plus rien ne l'appelle), `src/shells/desktop/ui/panels/agence/Reglages.tsx` (nouveau), `Reglages.test.tsx` (nouveau), `AgenceView.tsx`, `AgenceView.test.tsx`, `docs/architecture.md` (« The agence panel »).

**Dépend de** : lot 1 ; 005-L5 mergé sur `origin/main`. **Parallélisable avec** : lot 2 (aucun fichier commun).

### Tests d'abord

- [ ] T040 [P] [US1] `src/panels/agence/session.test.ts` : `pratiquesView` garde `champs`, `presets`, `projet`, `nbProjet`, `invariants` (état sans eux : champs absents, aucune erreur) ; les ops `pratique.set`, `pratique.unset`, `pratique.preset` partent en `POST /pratiques/...` avec les bons champs ; régisseur arrêté : `unavailable` ; 400 : `invalid` avec la phrase ; l'op `openPratiques` n'existe plus. Modèle : sonnet.
- [ ] T041 [P] [US1] `src/shells/desktop/ui/panels/agence/Reglages.test.tsx` : avec un **schéma de fixture inventé** (clés `foo.bar`, `baz`, SC-004) : un contrôle par champ selon sa forme ; libellés, phrase, défaut, origine en mots ; « Revenir au défaut » seulement hors origine défaut ; « Avancé » replié ; invariants sans contrôle ; aucune clé ni accolade dans le texte rendu (SC-002) ; phrase de refus sous le champ. Modèle : sonnet.
- [ ] T042 [P] [US2] `Reglages.test.tsx` : presets : marque « actif » ; `nbProjet = 0` : pas de confirmation ; `nbProjet = 2` : confirmation `ClientUi` qui cite 2, « Annuler » n'envoie rien, « Continuer » envoie `remplacer` ; politique invalide : formulaire en lecture seule et « Repartir des réglages par défaut » derrière une confirmation. Modèle : sonnet.
- [ ] T043 [P] [US1] `AgenceView.test.tsx` : un bouton « Réglages » ouvre le formulaire ; « Ouvrir le fichier » absent ; ligne « Accès des agents à Cate » qui demande `openSettings('cli')` ; état sans `champs` : la ligne de 005-L5 seule. Modèle : haiku.

### Implémentation

- [ ] T044 [US1] `src/panels/agence/contract/types.ts`, `session.ts` : types et relais ; suppression de `openPratiques`, `pratiquesFile.ts`, `openEditor` s'il n'a plus d'usage (grep cité dans la PR). Rend T040 vert. Modèle : sonnet.
- [ ] T045 [US1] `src/shells/desktop/ui/panels/agence/Reglages.tsx` : le formulaire générique ; `AgenceView.tsx` : bouton « Réglages », remplacement du détail en lecture seule de 005-L5. Rend T041 à T043 verts. Modèle : sonnet.
- [ ] T046 [P] `docs/architecture.md` : une phrase : les réglages de l'agence s'écrivent par le régisseur (`/pratiques/...`), la vue rend les champs publiés. Modèle : haiku.
- [ ] T047 Portes et PR du lot 3. Corps : écart avec upstream (aucun hors panneau agence), code supprimé, « e2e non exécuté ». Modèle : haiku.

**Checkpoint lot 3** : le plafond d'agents se change dans le panneau et `agence pratiques show` le voit.

---

## Lot 4 : premières questions (US3)

**But** : à la première ouverture d'un workspace orchestré, les réglages essentiels sont posés en questions simples, avant que l'orchestrateur ne démarre.

**Tests d'acceptation** : Vitest vu rouge puis vert : `session.test.ts` (lancement différé), `PremieresQuestions.test.tsx` ; portes vertes ; e2e « non exécuté ».

**Fichiers touchés** : `src/panels/agence/contract/types.ts` (op `pratique.questions`), `src/panels/agence/session.ts` (lancement de l'orchestrateur), `src/panels/agence/session.test.ts`, `src/shells/desktop/ui/panels/agence/PremieresQuestions.tsx` (nouveau), `PremieresQuestions.test.tsx` (nouveau), `AgenceView.tsx`.

**Dépend de** : lot 3. **Parallélisable avec** : lot 2.

### Tests d'abord

- [ ] T060 [P] [US3] `src/panels/agence/session.test.ts` : état `projet: false` : régisseur lancé, orchestrateur non lancé ; op `pratique.questions` avec réponses : un seul `POST /pratiques/set` multiple, puis lancement ; avec `passer` : `POST /pratiques/preset` `neutre`, puis lancement ; état `projet: true` ou sans `projet` : lancement immédiat comme aujourd'hui ; seconde op après la fin : sans effet. Modèle : opus.
- [ ] T061 [P] [US3] `PremieresQuestions.test.tsx` : une question par écran, dans l'ordre reçu ; réponse par défaut présélectionnée ; « Précédent », « Terminer », « Passer » ; aucune clé visible ; schéma de fixture inventé. Modèle : sonnet.

### Implémentation

- [ ] T062 [US3] `session.ts` : lancement de l'orchestrateur conditionné à `projet` ; op `pratique.questions`. Rend T060 vert. Modèle : opus.
- [ ] T063 [US3] `PremieresQuestions.tsx`, `AgenceView.tsx` (les questions occupent le panneau tant que `projet` est faux). Rend T061 vert. Modèle : sonnet.
- [ ] T064 Portes et PR du lot 4. Modèle : haiku.
- [ ] T065 [H] Heifara essaie un dépôt neuf dans Cate et dit si les quatre questions sont les bonnes (Q7). L'agent contrôle ensuite en lecture seule le fichier du projet créé.

**Checkpoint lot 4** : un dépôt neuf pose ses questions, un dépôt réglé n'en pose aucune.

---

## Dépendances et parallélisme

- **Avec la spec 005** : 008-L1 après le merge de 005-L2 et 005-L3 (`agence.py`, `pratiques.py`, `pratiques.json`). 008-L3 après le merge de 005-L5 (tout le panneau). 008-L2 et 005-L4 visent `SKILL.md` : 005-L4 d'abord.
- **Avec la spec 004** : `declencheurs.json` (T008) après ses lots ouverts ; sinon T008 lui passe.
- **Avec la spec 006** : `SKILL.md`, 006-L3 avant 008-L2.
- **Entre lots de 008** : 2 et 3 en même temps (Python d'un côté, TypeScript de l'autre) ; 4 après 3.

## Stratégie

MVP : lots 1 et 3 (le formulaire existe et écrit). Le lot 2 tient la promesse « l'option n'est jamais la source » et branche les nouveaux réglages ; le lot 4 rend l'outil accessible dès la première ouverture.
