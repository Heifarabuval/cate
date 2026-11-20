# Feature Specification: Orchestrateur portable (le fork Cate livre tout)

**Feature Branch**: `docs/specs-002-orchestrateur-portable`

**Created**: 2026-11-18 (dépôt Skills, `specs/006-orchestrateur-portable`, commit `1577235`)

**Rapatriée**: 2026-11-19 dans le fork, devenue `specs/002-orchestrateur-portable`. Issue : Heifarabuval/cate#29.

**Status**: Livrée sauf la recette. Lots 0, 1, 2, 3, 4, 4b et 5 livrés (état relu sur `origin/main` `455a23b2` le 2026-11-20) ; reste le lot 5-A (parcours en faux HOME avec la vraie CLI), 5-B (rapport final), 5-C (premier passage réel de Max) et 5-D (suites côté Skills). Voir `tasks.md`, partie B.

**Input**: besoin #n159. Max, collègue de Heifara, doit avoir le même système d'orchestration : panneau agence (PR #18), CLI `agence`, skill `orchestrateur`, gardes d'envoi. Décision de Heifara : le code de l'orchestrateur vit dans le fork Cate, pas dans le dépôt Skills ; Max l'obtient en buildant le fork, un seul dépôt. Max a son propre Cate et son propre `~/.claude`.

## Clarifications

### Session 2026-11-18

- Q: Où vit le code ? → A: dans le fork Heifarabuval/cate (décision de Heifara, donnée dans le brief). Skills ne garde que la config personnelle de Heifara.
- Q: Max peut-il rester sur Cate upstream ? → A: non pour l'orchestrateur : la CLI `agence` et le type `agence` ne sont livrés que par le fork. Cate upstream reste utilisable pour le reste. Voir research R6.

### Session 2026-11-19 (rapatriement)

- Q: Quelle plateforme ? → A: macOS Apple silicon seulement (constitution du fork, principe VIII). Plus aucun cas Linux ni Windows à spécifier. Une capacité propre à macOS, absente ailleurs, n'a pas d'effet et ne lève pas d'erreur.
- Q: Quels noms pour l'amorçage et la mise à jour ? → A: ceux livrés par la PR #40 : `scripts/cate-fork-install.sh`, `scripts/cate-fork-update.sh`, `scripts/cate-fork-uninstall.sh`, agent launchd `com.cate.fork-update`. Les noms `agence-install.sh`, `agence-uninstall.sh` et `fr.adfinitas.cate-fork-update` de la version Skills sont abandonnés (coupes nettes, principe III).
- Q: Nom par défaut quand rien n'est réglé ? → A: « L'humain » (PR #41), pas « toi » (qui donnait « toi a cliqué Envoyer »).
- Q: Valeur stockée `owner` ? → A: la clé `heifara` reste, opaque, sans migration (déjà livré par la PR #41) ; Max ne la voit jamais (`need list` affiche `humain`). Décision de Heifara (q303, besoin n304).
- Q: Où vit la vérification des prérequis ? → A: `agence doctor --prerequis` ; `agence doctor` sans option reste le contrôle de relance de la spec 001. Décision de Heifara (q305, besoin n306).
- Q: `cliTerminalInputEnabled` activé par défaut dans le fork ? → A: non, il reste coupé (réglage de sécurité) ; Max garde un clic par workspace orchestré, nommé par `doctor --prerequis`. Décision de Heifara (q307, besoin n308).

### Session 2026-11-20

- Q: Comment part le DM « Ta journée » de Heifara, que le garde du fork met en `ask` (T050) ? → A: par Hermes. Décision de Heifara (q508) ; le changement est côté dépôt Skills, à faire avant lundi 2026-11-23.

## État livré au 2026-11-20

| Lot | Contenu | Preuve |
|---|---|---|
| 0. Risques | rapport des quatre sondes | `rapport-lot0.md` (Skills `78a8fd3`) |
| 1. CLI dans le runtime | `tools/agence/`, tarball, lanceurs `agence` des terminaux et du régisseur, `--version`, CI Python 3.9 | PR #30 (`332b3815`) |
| 2. Portable | `nom()`, `agence nom`, textes au nom de l'humain, alias `--owner heifara` retiré (PR #41) ; skill `orchestrateur` livré, `watch` écrit `humain`, panneau « À faire par <nom> », plus de page sous `--token-stdin`, test de pureté (PR #63) | PR #41 (`8ec4d5ad`), PR #63 (`bcb0ca6a`) |
| 3. Gardes et prérequis | `agence hooks install\|uninstall\|status`, `agence guard --mode send\|pages`, lanceur `agence-hook`, `agence doctor --prerequis`, `garde` dans l'état et bannière du panneau | PR #65 (`c23a5c0d`) |
| 4. Mise à jour et amorçage | une ligne `curl \| sh`, agent launchd, build quand `origin/main` avance, installation Cate fermé, désinstallation (PR #40) ; gardes et `doctor --prerequis --hors-cate` dans l'amorçage, `--sans-gardes`, `--gardes` (PR #68) ; le script de mise à jour reste si la purge échoue (PR #70) | PR #40 (`5c6678c7`), PR #68 (`5a85aca4`), PR #70 (`684034d2`) |
| 4b. Le daemon suit l'app | mise à jour du runtime d'un autre build de même version | PR #27 (`dd4c3c9f`), Closes #26 |
| 5. Bascule de Skills | Skills ne livre plus la CLI, le skill ni les gardes ; `agence guard` exige `--mode` | Skills#36 et Skills#37 (mergée le 2026-11-20), fork PR #96 (`7b41cd32`) ; relevé chez Heifara le 2026-11-20 : `agence hooks status` = `actif` |

Reste (`tasks.md`, partie B) : un test qui rejoue l'amorçage avec la vraie CLI (lot 5-A), le rapport final (5-B), le premier passage réel de Max (5-C), `measure.py` et l'exception du DM de Heifara côté Skills (5-D), et le réglage `agence.nom` de Heifara (T014). Aucun code produit à écrire dans le fork.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Max installe le fork et orchestre un projet (Priority: P1)

Max colle la ligne d'amorçage (`scripts/cate-fork-install.md`). Le script construit et installe le fork, branche les gardes et lance `agence doctor --prerequis --hors-cate`. Il ouvre Cate sur un dépôt, lance `/orchestrateur` dans Claude Code. Un panneau agence apparaît ; ses brouillons et questions s'affichent sous « À faire par Max ».

**Why this priority**: c'est le but de #n159.

**Independent Test**: Mac avec un HOME neuf, Xcode Command Line Tools, `gh` connecté, `claude` installé. Suivre `quickstart.md` de bout en bout ; compter les commandes tapées hors quickstart (0 attendu).

**Acceptance Scenarios**:

1. **Given** le fork installé, **When** Max tape `agence --help` dans un terminal Cate, **Then** l'aide s'affiche sans rien installer d'autre. Livré (PR #30).
2. **Given** un terminal Cate restauré après relance de l'app, **When** Max tape `agence need list`, **Then** la commande est trouvée. Livré par le code (PR #30, lanceur réécrit à chaque spawn) ; non vérifié sur un vrai terminal restauré.
3. **Given** `git config user.name` = « Max Croquet » et aucun réglage, **When** le suivi s'affiche, **Then** la section s'appelle « À faire par Max ». Livré : CLI (PR #41), panneau (PR #63, `SuiviList.tsx:12`).
4. **Given** `agence doctor --prerequis`, **When** un prérequis manque, **Then** chaque manque sort sur une ligne avec la commande qui le règle, et le code de sortie est 1. Livré (PR #65, `test_doctor.py`).
5. **Given** un dépôt avec un dossier `.claude/`, **When** Max ouvre le workspace, **Then** `.claude/skills/orchestrateur/SKILL.md` est semé comme `cate-cli`. Livré (PR #63, `scripts/build-runtime-tarball.mjs:161`) ; tarball réel non listé, semis non vérifié sur un vrai dépôt (lot 5-C, R7).

---

### User Story 2 - Seul le clic de l'humain envoie, aussi chez Max (Priority: P1)

Les gardes sont branchés dans le `~/.claude/settings.json` de Max par `agence hooks install`, lancé par l'amorçage ou par lui. Sans eux, le panneau le dit.

**Why this priority**: seul le clic de l'humain envoie (règle de l'orchestrateur, non négociable).

**Independent Test**: faux HOME avec un `settings.json` existant (hooks et permissions de Max) ; `agence hooks install` deux fois, puis `uninstall` ; comparer les fichiers.

**Acceptance Scenarios**:

1. **Given** un `settings.json` avec ses propres hooks, **When** Max lance `agence hooks install` deux fois, **Then** les gardes agence apparaissent une seule fois, ses entrées restent identiques, une sauvegarde datée existe.
2. **Given** les gardes installés, **When** Max lance `agence hooks uninstall`, **Then** seules les entrées agence disparaissent.
3. **Given** aucun garde installé, **When** le panneau agence s'ouvre, **Then** une bannière dit « garde d'envoi inactif » et la commande `agence hooks install`.
4. **Given** un agent de Max qui appelle `slack_send_message` sans brouillon cliqué, **When** le garde est actif, **Then** Claude Code demande confirmation (décision `ask`).
5. **Given** la CLI `agence` introuvable au moment du hook, **When** un agent appelle un outil d'envoi Slack ou Gmail, **Then** la décision est `ask` (le garde échoue fermé).

---

### User Story 3 - Heifara ne perd rien (Priority: P1)

Heifara passe sur la CLI livrée par le fork. Ses états `state.json` existants, ses brouillons, son skill et sa config restent valides.

**Why this priority**: il orchestre tous les jours ; une régression bloque son travail.

**Independent Test**: copier un `state.json` réel (owner `heifara`) dans un dossier jetable, lancer la CLI livrée et le panneau ; les sections et les actions sont identiques à avant.

**Acceptance Scenarios**:

1. **Given** un état avec `owner: "heifara"`, **When** la CLI du fork l'ouvre, **Then** les lignes restent dans « À faire par <nom> » ; l'état n'est pas réécrit.
2. **Given** `agence.nom` réglé à « Heifara », **When** il ouvre le suivi, **Then** les textes disent « Heifara » comme aujourd'hui.
3. **Given** son ancien `~/.claude/bin/agence`, **When** il tape `agence` dans un terminal Cate, **Then** c'est la CLI du runtime qui répond (PATH du terminal en tête). Livré par le code (PR #30) ; non vérifié chez lui.

---

### User Story 4 - Le Cate de Max se met à jour sans commande (Priority: P2)

Un agent launchd lance `cate-fork-update` : il récupère le fork, construit en arrière-plan, installe l'app quand Cate est fermé. Le daemon d'un workspace inactif passe sur le nouveau build à l'ouverture suivante ; un workspace occupé demande avant. L'amorçage tient en une ligne collée une fois.

**Why this priority**: sans mise à jour simple, Max reste sur une vieille version et les deux setups divergent.

**Independent Test**: tests du script en faux HOME (`scripts/cate-fork-install.test.mjs`) ; recette réelle au premier passage de Max.

**Acceptance Scenarios**:

1. **Given** des agents en cours dans un workspace, **When** l'app passe sur un nouveau build de même version, **Then** le workspace demande avant d'arrêter quoi que ce soit ; s'il est partagé avec un autre client, il ne bouge pas. Livré (PR #27).
2. **Given** un build qui échoue ou un Node hors plage, **When** le script s'arrête, **Then** l'app installée n'a pas changé et le message dit pourquoi. Livré (PR #40).
3. **Given** un Mac sans rien d'installé, **When** Max colle la ligne d'amorçage, **Then** il n'a aucune autre commande à taper, sauf pour installer un prérequis nommé par le script. Livré (PR #40 pour l'app, PR #68 pour les gardes et `doctor`) ; jamais rejoué avec la vraie CLI ni sur un Mac vierge (lots 5-A et 5-C).

### Edge Cases

- `python3` absent ou stub de macOS sans Command Line Tools : le lanceur `agence` le dit (`xcode-select --install`) et sort en 2 sans ouvrir la boîte de dialogue système (livré, `tools/agence/agence:7-15`).
- `git config user.name` vide : nom par défaut « L'humain » (livré, `agence.py:80-92`).
- Dépôt sans remote GitHub : `ghRepo` reste `null`, les brouillons `issue:`/`pr:` exigent un `owner/repo` explicite (comportement actuel).
- `settings.json` illisible (JSON invalide) : l'installeur des gardes refuse et n'écrit rien.
- `settings.json` lien symbolique (cas de Heifara, `skills.sh`) : l'installeur écrit la cible, pas le lien.
- `settings.json` en lecture seule (fichier ou dossier) : refus, rien écrit, mode d'origine conservé (rapport du lot 0).
- Deux runtimes de builds différents ouverts : chaque terminal voit la CLI de son runtime ; le hook utilise `~/.cate/runtime/current`.
- Max sur Cate upstream : `agence` introuvable ; `scripts/cate-fork-install.md` le dit.
- Amorçage chez Heifara : le lot 5 est livré, un seul jeu de gardes (`agence hooks status` = `actif`, relevé le 2026-11-20). `--sans-gardes` reste pour qui a déjà ses propres gardes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le runtime du fork MUST livrer la CLI `agence` (`agence.py`, Python 3.9 stdlib) et la mettre sur le PATH de tout terminal Cate et du régisseur, sans installation par l'utilisateur. **Livré** (PR #30).
- **FR-002**: Le fork MUST livrer le skill `orchestrateur` parmi ses skills livrés (`skills/`), semé dans les dépôts par le mécanisme existant. **Livré** (PR #63).
- **FR-003**: Le nom de l'humain MUST se lire, dans l'ordre : `AGENCE_NOM`, `git config agence.nom`, premier mot de `git config user.name`, « L'humain ». **Livré côté CLI** (PR #41) ; le panneau affiche ce nom. **Livré** (PR #63).
- **FR-004**: L'état MUST rester compatible : la valeur stockée reste `heifara`, clé opaque jamais affichée (la CLI affiche `humain`, le panneau le nom). Aucune migration. **Livré côté CLI** (PR #41).
- **FR-005**: Le dépôt GitHub MUST venir de `gh repo view` (existant), jamais d'un nom fixe ; aucun chemin `/Users/...` dans le code livré.
- **FR-006**: La notification système MUST ne jamais faire échouer une commande quand `osascript` manque. **Satisfait par le code existant** : `toast()` journalise l'échec (`agence.py:315-321`) et `_run` rend 127 sur `OSError`.
- **FR-007**: `agence hooks install|uninstall|status` MUST fusionner les gardes dans `~/.claude/settings.json` de façon idempotente, avec sauvegarde, sans toucher aux autres entrées. Cate ne l'appelle jamais. **Livré** (PR #65).
- **FR-008**: Le garde d'envoi MUST échouer fermé (`ask`) quand la CLI est introuvable ; le garde des pages et de `state.json` peut échouer ouvert (sans CLI, pas de projet orchestré). **Livré** (PR #65, `test_guard.py`) ; les décisions `ask` en réel : lot 5-C, R9.
- **FR-009**: `agence doctor --prerequis` MUST vérifier python3, `gh auth status`, `claude`, la version de Cate (CLI livrée, `--model`, `agent usage`, type `agence`), les réglages CLI du workspace, les gardes, le skill, le nom ; une ligne par point, code 1 si un point bloque. Avec `--hors-cate`, les points qui exigent un terminal Cate sortent en `info`. **Livré** (PR #65 et #68).
- **FR-010**: Le panneau agence MUST afficher l'état du garde (actif, inactif, partiel) lu dans l'état écrit par le régisseur, et le nom de l'humain. **Livré** (PR #63 et #65).
- **FR-011**: `scripts/cate-fork-update.sh` MUST construire le fork quand la branche suivie avance, installer l'app seulement Cate fermé, vérifier la version de Node avant de construire, n'arrêter aucun daemon, et s'arrêter sans rien changer à la première erreur. Le client MUST traiter un runtime de même version et de build différent comme un runtime plus ancien. **Livré** (PR #40, PR #27).
- **FR-012**: Rien de personnel à Heifara ne part dans le fork (Slack, Gmail, Google Tasks, rules, `CLAUDE.md`, bus, ID de son DM Slack).
- **FR-013**: Après la ligne d'amorçage, Max MUST n'avoir aucune commande à taper : `scripts/cate-fork-install.sh` branche aussi les gardes (sauf `--sans-gardes`) et lance `agence doctor --prerequis --hors-cate` ; `scripts/cate-fork-uninstall.sh --gardes` les retire. **Livré** (PR #40 et #68) ; rejoué en faux HOME avec la vraie CLI au lot 5-A, sur un Mac vierge au lot 5-C.

### Key Entities

- **Humain** : la personne qui clique ; un nom affiché (`agence nom`), une valeur d'état `owner`.
- **Garde** : les entrées `PreToolUse` agence dans `settings.json` ; actif, inactif ou partiel.
- **Install du runtime** : `~/.cate/runtime/<build>/`, qui contient `agence/` (livré) et `skills/orchestrateur/` (à livrer).

## Success Criteria *(mandatory)*

- **SC-001**: Max passe de « ligne collée » à « panneau agence ouvert » en moins de 30 min hors prérequis, dont 0 fichier édité à la main.
- **SC-002**: 0 occurrence de « Heifara » ou « heifara » dans le code livré par le fork (`tools/agence`, `skills/orchestrateur`, `src/panels/agence`, `src/shells/desktop/ui/panels/agence`), hors tests et hors la clé opaque de la valeur stockée (une ligne dans `agence.py`, une dans le panneau). URL du dépôt `Heifarabuval/cate` exclues : c'est l'adresse du fork.
- **SC-003**: `agence hooks install` lancé 2 fois donne un `settings.json` identique à 1 fois ; `uninstall` rend le fichier d'origine en JSON (hors ordre des clés et mise en forme, rapport du lot 0).
- **SC-004**: la suite `npm run test:agence` passe sous `/usr/bin/python3` 3.9.6 de macOS (CI `agence (macos-latest)` sous 3.9).
- **SC-005**: 0 régression chez Heifara : ses états existants s'ouvrent, ses sections restent identiques.

## Assumptions

- Max est sur macOS Apple silicon (constitution, principe VIII).
- Max a les Xcode Command Line Tools (requis pour `git` et le build du fork), donc `/usr/bin/python3` 3.9.6.
- Le fork est public : la ligne `curl` marche sans compte (vérifié le 2026-11-18).
- Max lance `gh auth login` lui-même si l'amorçage le demande.
- Slack et Gmail chez Max : optionnels. Sans connecteur MCP, les brouillons `mail:` ne partent pas ; sans `SLACK_USER_TOKEN` dans `~/.hermes/.env`, les brouillons `slack:` restent à valider avec le refus affiché ; `issue:`, `pr:`, `comment:` marchent par `gh`.
- Coût mensuel : 0 € (aucun service, aucune dépendance ajoutée).
