# Feature Specification: Orchestrateur portable (le fork Cate livre tout)

**Feature Branch**: `feat/spec-orchestrateur-portable`

**Created**: 2026-11-18

**Status**: Draft, à valider par Heifara avant `tasks.md`

**Input**: besoin #n159. Max, collègue de Heifara, doit avoir le même système d'orchestration : panneau agence (fork Heifarabuval/cate, PR cate#18), CLI `agence`, skill `orchestrateur`, gardes `send-guard` et `agence-guard`. Décision de Heifara : le code de l'orchestrateur vit dans le fork Cate, pas dans le dépôt Skills ; Max l'obtient en buildant le fork, un seul dépôt. Max a son propre Cate et son propre `~/.claude`.

## Clarifications

### Session 2026-11-18

- Q: Où vit le code ? → A: dans le fork Heifarabuval/cate (décision de Heifara, donnée dans le brief). Skills ne garde que la config personnelle de Heifara.
- Q: Max peut-il rester sur Cate upstream ? → A: non pour l'orchestrateur : la CLI `agence` et le type `agence` ne sont livrés que par le fork. Cate upstream reste utilisable pour le reste. Voir research R6.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Max installe le fork et orchestre un projet (Priority: P1)

Max clone le fork, lance le script de mise à jour, ouvre Cate sur un dépôt. Dans un terminal Cate, `agence doctor` dit ce qui manque. Il lance `agence hooks install`, puis `/orchestrateur` dans Claude Code. Un panneau agence apparaît ; ses brouillons et questions s'affichent sous « À faire par Max ».

**Why this priority**: c'est le but de #n159.

**Independent Test**: Mac avec un HOME neuf (compte de test macOS), Xcode Command Line Tools, `gh` connecté, `claude` installé. Suivre `quickstart.md` de bout en bout ; compter les commandes tapées hors quickstart (0 attendu).

**Acceptance Scenarios**:

1. **Given** le fork installé, **When** Max tape `agence --help` dans un terminal Cate, **Then** l'aide s'affiche sans rien installer d'autre (CLI livrée avec le runtime).
2. **Given** un terminal Cate restauré après relance de l'app, **When** Max tape `agence need list`, **Then** la commande est trouvée.
3. **Given** `git config user.name` = « Max Croquet » et aucun réglage, **When** le suivi s'affiche, **Then** la section s'appelle « À faire par Max ».
4. **Given** `agence doctor`, **When** un prérequis manque, **Then** chaque manque sort sur une ligne avec la commande qui le règle, et le code de sortie est 1.

---

### User Story 2 - Seul le clic de l'humain envoie, aussi chez Max (Priority: P1)

Les gardes sont branchés dans le `~/.claude/settings.json` de Max par un installeur qu'il lance lui-même. Sans eux, le panneau le dit.

**Why this priority**: principe III de la constitution (non négociable).

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

**Independent Test**: copier un `state.json` réel (owner `heifara`) dans un dépôt de test, lancer la CLI livrée et le panneau ; les sections et les actions sont identiques à avant.

**Acceptance Scenarios**:

1. **Given** un état avec `owner: "heifara"`, **When** la nouvelle CLI l'ouvre, **Then** les lignes restent dans « À faire par Heifara » et l'état est réécrit avec la valeur neutre au premier `tx`.
2. **Given** `agence.nom` réglé à « Heifara », **When** il ouvre le suivi, **Then** les textes disent « Heifara » comme aujourd'hui.
3. **Given** son ancien `~/.claude/bin/agence`, **When** il tape `agence` dans un terminal Cate, **Then** c'est la CLI du runtime qui répond (PATH du terminal en tête).

---

### User Story 4 - Le Cate de Max se met à jour sans commande (Priority: P2)

Un agent launchd lance `scripts/cate-fork-update.sh` : il récupère le fork, construit en arrière-plan, installe l'app quand Cate est fermé. Le daemon d'un workspace inactif passe sur le nouveau build à l'ouverture suivante ; un workspace occupé demande avant. L'amorçage (`scripts/agence-install.sh`) tient en une ligne collée une fois.

**Why this priority**: sans mise à jour simple, Max reste sur une vieille version et les deux setups divergent.

**Independent Test**: lancer le script sur une branche du fork avec un commit traceur ; vérifier la chaîne traceur dans `~/.cate/runtime/<build>/runtime.cjs` et dans `agence --version`.

**Acceptance Scenarios**:

1. **Given** des agents en cours dans un workspace, **When** l'app passe sur un nouveau build de même version, **Then** le workspace demande avant d'arrêter quoi que ce soit ; s'il est partagé avec un autre client, il ne bouge pas.
2. **Given** un build qui échoue ou un Node hors plage, **When** le script s'arrête, **Then** l'app installée n'a pas changé et le message dit pourquoi.
3. **Given** un Mac sans rien d'installé, **When** Max colle la ligne d'amorçage, **Then** il n'a aucune autre commande à taper, sauf pour installer un prérequis nommé par le script.

### Edge Cases

- `python3` absent ou stub de macOS sans Command Line Tools : le lanceur `agence` le dit (`xcode-select --install`) au lieu d'ouvrir la boîte de dialogue système en plein régisseur.
- Hors macOS : pas d'`osascript`, la notification est écrite au journal, rien ne plante.
- `git config user.name` vide : nom par défaut « toi ».
- Dépôt sans remote GitHub : `ghRepo` reste `null`, les brouillons `issue:`/`pr:` exigent un `owner/repo` explicite (comportement actuel, `agence.py:315-319`).
- `settings.json` illisible (JSON invalide) : l'installeur refuse et n'écrit rien.
- `settings.json` lien symbolique (cas de Heifara, `skills.sh`) : l'installeur écrit la cible, pas le lien.
- Deux runtimes de builds différents ouverts : chaque terminal voit la CLI de son runtime ; le hook utilise `~/.cate/runtime/current`.
- Max sur Cate upstream : `agence` introuvable, `agence doctor` aussi ; le README du fork le dit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le runtime du fork MUST livrer la CLI `agence` (`agence.py`, Python 3.9 stdlib) et la mettre sur le PATH de tout terminal Cate et du régisseur, sans installation par l'utilisateur.
- **FR-002**: Le fork MUST livrer le skill `orchestrateur` parmi ses skills livrés (`skills/`), installé dans les dépôts par le mécanisme existant.
- **FR-003**: Le nom de l'humain MUST se lire, dans l'ordre : `AGENCE_NOM`, `git config agence.nom`, premier mot de `git config user.name`, « toi ». Aucun « Heifara » codé en dur dans le fork.
- **FR-004**: L'état MUST rester compatible : `owner: "heifara"` lu comme l'humain ; la CLI réécrit la valeur neutre `humain`. Le panneau ne lit que `humain`.
- **FR-005**: Le dépôt GitHub MUST venir de `gh repo view` (existant), jamais d'un nom fixe ; aucun chemin `/Users/...` dans le code livré.
- **FR-006**: La notification système MUST se dégrader en une ligne de journal hors macOS ou sans `osascript`.
- **FR-007**: `agence hooks install|uninstall` MUST fusionner les gardes dans `~/.claude/settings.json` de façon idempotente, avec sauvegarde, sans toucher aux autres entrées. Cate ne l'appelle jamais.
- **FR-008**: Le garde d'envoi MUST échouer fermé (`ask`) quand la CLI est introuvable ; le garde des pages et de `state.json` peut échouer ouvert (sans CLI, pas de projet orchestré).
- **FR-009**: `agence doctor` MUST vérifier python3, `gh auth status`, `claude`, la version de Cate (CLI livrée, `--model`, `agent usage`, type `agence`), les réglages CLI du workspace, les gardes, le nom ; une ligne par point, code 1 si un point bloque.
- **FR-010**: Le panneau agence MUST afficher l'état du garde (actif, inactif) lu dans l'état écrit par le régisseur.
- **FR-011**: `scripts/cate-fork-update.sh` MUST construire le fork quand `origin/main` avance, installer l'app seulement Cate fermé, vérifier la version de Node avant de construire, n'arrêter aucun daemon, et s'arrêter sans rien changer à la première erreur. Le client MUST traiter un runtime de même version et de build différent comme un runtime plus ancien (mise à jour inactif, demande si occupé, aucune coupure silencieuse).
- **FR-013**: Après la ligne d'amorçage, Max MUST n'avoir aucune commande à taper (`scripts/agence-install.sh`, idempotent, désinstallation par `scripts/agence-uninstall.sh`).
- **FR-012**: Rien de personnel à Heifara ne part dans le fork (Slack, Gmail, Google Tasks, rules, `CLAUDE.md`, bus, ID de son DM Slack).

### Key Entities

- **Humain** : la personne qui clique ; un nom affiché, une valeur d'état `humain`.
- **Garde** : les entrées `PreToolUse` agence dans `settings.json` ; actif ou inactif.
- **Install du runtime** : `~/.cate/runtime/<build>/`, qui contient désormais `agence/`.

## Success Criteria *(mandatory)*

- **SC-001**: Max passe de « fork cloné » à « panneau agence ouvert » en moins de 30 min, dont 0 fichier édité à la main.
- **SC-002**: 0 occurrence de « Heifara » ou « heifara » dans le code livré par le fork, hors tests de compatibilité.
- **SC-003**: `agence hooks install` lancé 2 fois donne un `settings.json` identique à 1 fois ; `uninstall` rend le fichier d'origine à l'octet près (hors ordre des clés).
- **SC-004**: les 241 tests actuels d'`agence.py` passent sous `/usr/bin/python3` 3.9.6 de macOS, avant et après le transfert.
- **SC-005**: 0 régression chez Heifara : ses états existants s'ouvrent, ses sections restent identiques.

## Assumptions

- **Hypothèse à confirmer** : Max est sur macOS (Adfinitas est sur Mac). Sinon : pas de notification système (FR-006), lanceur POSIX seulement, pas de `cate.cmd` pour `agence` (Windows hors périmètre), build Linux non essayé.
- **Hypothèse à confirmer** : Max a les Xcode Command Line Tools (requis pour `git` et le build du fork), donc `/usr/bin/python3` 3.9.6.
- Max a un compte GitHub avec accès au fork (public ou invité) et lance `gh auth login` lui-même.
- Slack et Gmail chez Max : optionnels. Sans connecteur MCP, les brouillons `slack:` et `mail:` ne partent pas ; `issue:`, `pr:`, `comment:` marchent par `gh`.
- Coût mensuel : 0 € (aucun service, aucune dépendance ajoutée).
