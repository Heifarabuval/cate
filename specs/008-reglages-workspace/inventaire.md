# Inventaire : ce qui se règle ou est codé en dur dans l'agence et le fork

Base : `origin/main` `38789c7a` (fetch du 2026-11-20). Chaque ligne est lue dans le fichier cité. Les numéros de `agence.py` sont ceux d'`origin/main` ; la branche `feat/pratiques-retrait-code-en-dur` (005-L2, commit local `d0ac5108`, non mergée) les décale et change déjà `MAX_AGENTS`, `HERMES_ENV` et le merge.

Colonnes : **décision 008** dit ce que devient le paramètre. « Réglage » : une clé du schéma `pratiques.json`, visible et modifiable dans le formulaire. « Natif » : un réglage de Cate qui reste où il est (écran Réglages), le formulaire y renvoie. « Constante » : une valeur de plateforme, ni réglage ni option, avec la raison. « Option » : un choix par commande, qui reste une option.

Portée : **workspace** (fichier du projet `<racine>/.cate/tmp/agence/pratiques.json`, un par dépôt), **dev** (fichier du dev `~/.config/agence/pratiques.json`, tous ses projets), **plateforme** (le code).

## 1. Les 12 réglages de la spec 005 (`tools/agence/pratiques.json`)

| Paramètre | Où il vit aujourd'hui | Type et valeurs | Défaut (`neutre`) | Portée | Libellé en mots simples | Décision 008 |
|---|---|---|---|---|---|---|
| `livraison.mode` | `tools/agence/pratiques.json:3` | `pr`, `main` | `pr` | workspace | Comment le travail arrive : « par une demande de relecture » ou « directement sur la branche principale » | Réglage, essentiel |
| `livraison.merge` | `pratiques.json:4` | `clic`, `dehors` | `clic` | workspace | Qui fusionne : « vous, par le bouton du panneau » ou « vous, ailleurs (GitHub) » | Réglage |
| `livraison.methode` | `pratiques.json:5` | `squash`, `rebase`, `merge` | `squash` | workspace | Forme de l'historique : « un seul commit », « commits rejoués », « commit de fusion » | Réglage, avancé |
| `issue` | `pratiques.json:6` | `libre`, `obligatoire` | `libre` | workspace | Ticket par tâche : « si utile » ou « toujours » | Réglage |
| `tests` | `pratiques.json:8` | `libre`, `tdd` | `libre` | workspace | Tests : « au choix de l'agent » ou « un test qui échoue d'abord, puis le code » | Réglage, essentiel |
| `speckit` | `pratiques.json:10` | `non`, `au-dela-d-une-journee`, `toujours` | `non` | workspace | Cahier des charges écrit avant le code : « jamais », « au-delà d'une journée de travail », « toujours » | Réglage |
| `verification` | `pratiques.json:13` | `libre`, `differente` | `libre` | workspace | Relecture : « par l'agent lui-même » ou « par un second agent » | Réglage, essentiel |
| `preuve` | `pratiques.json:15` | liste de `pr-mergee`, `ci-verte`, `tests-locaux`, `rapport`, ou `null` | `null` (dérivée du mode) | workspace | Quand une tâche est finie : « demande fusionnée », « contrôles automatiques verts », « tests lancés », « compte rendu » | Réglage, avancé |
| `agents.max` | `pratiques.json:16` | entier de 1 à 16 | 4 | workspace | Agents en même temps, au plus | Réglage, essentiel |
| `declencheurs.actifs` | `pratiques.json:17` (liste lue dans `declencheurs.json`) | identifiants de la table | `["T1"]` | workspace | Entretien automatique : quelles commandes de ménage l'agence propose | Réglage, avancé (libellés : section 4) |
| `envoi.slack.variable` | `pratiques.json:18` | nom de variable, motif `^[A-Za-z_][A-Za-z0-9_]*$` | `SLACK_USER_TOKEN` | dev | Nom de la variable qui porte votre accès Slack | Réglage, avancé, portée dev |
| `envoi.slack.fichier` | `pratiques.json:19` | chemin qui commence par `~` ou `/`, ou `null` | `null` | dev | Fichier qui porte votre accès Slack | Réglage, avancé, portée dev |

Hors schéma, non réglables (`pratiques.json:25-30`, `invariants`) : seul le clic de l'humain envoie en son nom ; aucun agent ne merge, ne pousse ni ne force-push ; aucun secret dans la politique ; une tâche ne passe en fait que sur preuve. Le formulaire les affiche en texte fixe.

Cohérences refusées (`pratiques.json:21-24`) : `main` avec une preuve de PR ; `differente` avec `agents.max = 1`.

## 2. Options de ligne de commande

| Option | Où | Type | Défaut | Aujourd'hui | Décision 008 |
|---|---|---|---|---|---|
| `agence start --max-agents N` | `agence.py:2792-2793`, écrit `st['maxAgents']` (`:457-458`) ; sur 005-L2 il écrit `agents.max` dans le fichier du projet | entier ≥ 1 (`entier_positif`, `:437-440`) | aucun | source persistante | **Contournement ponctuel** (section « Options » du plan) : valeur de la couche `ponctuel`, effacée au prochain `agence start` |
| `agence start --notify / --no-notify` | `agence.py:2790-2791`, écrit `st['notify']` (`:455-456`), lu à `:1616` | booléen | `True` (`empty()`, `:164`) | source persistante dans `state.json` | Réglage `notifications.systeme` (nouveau) ; l'option devient ponctuelle comme `--max-agents` ; la clé `notify` de l'état disparaît |
| `agence need add --model` | `agence.py:2814` | id ou alias de l'agent CLI | aucun | choix par besoin | Option, qui l'emporte sur le réglage `agents.modele` (nouveau) |
| `agence need add --effort` | `agence.py:2815`, valeurs `EFFORTS` (`:55`) | `low` à `max` | aucun | choix par besoin | Option, qui l'emporte sur le réglage `agents.effort` (nouveau) |
| `agence need add --budget`, `--budget-usd` | `agence.py:2812-2813` | entier, dollars | aucun | choix par besoin | Option inchangée (Q5 : pas de budget par défaut en v1) |
| `agence need add --done-when` | `agence.py:2810` | texte (grammaire fermée en 005-L3) | dérivé de `preuve` (005-L3) | choix par besoin | Option inchangée (le défaut vient déjà de `preuve`) |
| `agence watch --interval` | `agence.py:2860`, `:2037` | secondes | 30 | lancé par la session | Constante de plateforme : seule la session lance `watch` |
| `agence observe list --jours`, `declencheurs bilan --jours` | `agence.py:2885`, `:2892` | jours | 14, 30 | requête | Option de requête, pas un réglage |
| `agence hooks --settings` | `agence.py:2875` | chemin | `~/.claude/settings.json` | installation | Option d'installation, pas un réglage |
| `agence doctor --hors-cate` | `agence.py:2867` | booléen | faux | mode | Option, pas un réglage |

## 3. Constantes de `tools/agence/agence.py`

| Constante | Ligne | Valeur | Décision 008 | Raison |
|---|---|---|---|---|
| `MAX_AGENTS` | `:54` | 4 | Supprimée par 005-L2 (`agents.max`) | déjà traité |
| `EFFORTS` | `:55` | `low` à `max` | Constante | liste fermée de `cate agent start --effort` ; sert de valeurs permises à `agents.effort` |
| `JOURS_JOURNAL` | `:56` | 14 | Constante | miroir de `RETENTION_DAYS` (`src/workspace/observation/contract/retention.ts`), règle de vie privée de la spec 003 |
| `OWNER_HUMAIN` | `:91` | `'heifara'` | Constante interne | valeur stockée jamais affichée (commentaire `:89-90`), passe à `humain` avec la spec 006 |
| `RAPPEL` | `:367`, lu `:1619` | 300 s | Réglage `notifications.rappel` (nouveau) | une préférence de personne (être relancé ou non) |
| `SETTINGS_HINT` | `:488` | texte | Constante | message d'aide vers les réglages natifs |
| `MERGE_OPTIONS` | `:739` | « Merger (rebase) » | Suit `livraison.methode` (005-L2) | déjà traité |
| `GH_TIMEOUT`, `GH_PERIME` | `:744`, `:745` | 10 s, 300 s | Constante | protège le régisseur d'un `gh` lent ; aucune personne ne le choisit |
| `PIED`, `SCREEN_TIMEOUT` | `:1405`, `:1406` | 6 lignes, 5 s | Constante | lecture d'écran d'un terminal |
| `PYTHON_MIN` | `:1850` | 3.9 | Constante | plateforme (constitution VIII) |
| `CLI_REGLAGES` | `:1852-1854` | 8 clés `cli*Enabled` | Constante (miroir des défauts natifs) | voir section 5 |
| `JOURS_JOURNAL_DECL`, `JOURS_BILAN`, `DELAI_VERDICT` | `:2057-2059` | 90 j, 30 j, 60 s | Constante | mesure des déclencheurs (spec 004) |
| `SETUP_JAMAIS_EN_A` | `:2048` | liste | Constante | invariant de la spec 004 (FR-006) : jamais réglable |

## 4. Table `tools/agence/declencheurs.json` (spec 004)

10 lignes (`T1` à `T10`), champs `id`, `commande`, `condition`, `seuil`, `repos`, `plafond`, `actif`, `classe` (liste fermée `CHAMPS_TABLE`, `agence.py:2047`). Exemple `T1` (`declencheurs.json:3`) : `/compact`, `contexte-repos`, seuil 150 000 jetons, repos 600 s, plafond 3, actif, classe A.

| Champ | Décision 008 |
|---|---|
| `actif` | Remplacé par `declencheurs.actifs` (005-L4, Q5 de 005) |
| `seuil`, `repos`, `plafond` | Restent des données de la table (spec 004), non exposés en v1 (Q4) |
| libellé lisible | Absent : la table n'a que `commande` (`/compact`) et `hypothese`. Le formulaire a besoin d'un nom en mots simples par déclencheur : un champ `nom` ajouté à la table et à `CHAMPS_TABLE` (lot 1, conflit 004) |

## 5. Réglages natifs de Cate qui touchent l'agence

| Paramètre | Où | Défaut | Portée | Décision 008 |
|---|---|---|---|---|
| `cliEnabled`, `cliPanelReadEnabled`, `cliPanelControlEnabled`, `cliAgentReadEnabled`, `cliAgentControlEnabled`, `cliTerminalReadEnabled`, `cliSkillInstallEnabled` | `src/kernel/api/contract/settings.ts:8-22` | `true` | workspace (natif, `settings.json` du runtime) | **Natif**, inchangé (upstream) ; l'écran Réglages > Workspace > CLI les montre déjà |
| `cliTerminalInputEnabled` | `src/kernel/api/contract/settings.ts:16` | `false` | workspace (natif) | Natif ; `doctor --prerequis` dit déjà de le cocher (`agence.py:1855`) ; le formulaire affiche un lien vers la page `cli` |
| `agentHookInjection`, `usagePriceOverrides` | `src/services/agents/contract/settings.ts:22`, `:28` | `{}` | workspace (natif) | Natif, hors agence |

## 6. Variables d'environnement lues par l'agence

| Variable | Où | Décision 008 |
|---|---|---|
| `AGENCE_NOM` | `agence.py:104` | Reste (spec 002, nom de l'humain) ; le formulaire affiche le nom et sa source, sans l'éditer (Q6) |
| `AGENCE_ROOT` | `agence.py:135` | Reste : tests et dépannage, pas une préférence |
| `HERMES_ENV` | `agence.py:670` | Supprimée par 005-L2 (`envoi.slack.*`) |
| `CATE_HOME`, `CATE_SOCKET`, `CLAUDE_PROJECT_DIR`, `HOME` | `agence.py:1831`, `:294`, `:2443`, `:1995` | Plateforme, posées par Cate ou le shell |

## 7. Textes du skill qui recopient une valeur

| Ligne | Texte | Décision 008 |
|---|---|---|
| `skills/orchestrateur/SKILL.md:20` | « Au plus 4 agents vivants par projet (réglable : `agence start --max-agents <n>`) » | Renvoie à `agence pratiques show` (plafond du workspace) ; l'option est citée comme ponctuelle |
| `skills/orchestrateur/SKILL.md:42` | « rappel unique après 5 min », « Coupure pour le projet : `agence start --no-notify` » | Renvoie aux réglages `notifications.*` du panneau |
| `skills/orchestrateur/SKILL.md:24` | modèle et effort déclarés sur le besoin | Ajoute : sans option, le besoin prend `agents.modele` et `agents.effort` du workspace |

## Nouveaux réglages proposés (4)

| Clé | Valeurs | Défaut (`neutre` et `pr-tdd`) | Portée | Libellé | Remplace |
|---|---|---|---|---|---|
| `notifications.systeme` | `oui`, `non` | `oui` | workspace | Prévenir par une notification du Mac quand l'agence vous attend | `st['notify']`, `--notify` comme source |
| `notifications.rappel` | 0, 300, 900 (secondes) | 300 | workspace | Rappel si vous n'avez pas répondu : « jamais », « après 5 minutes », « après 15 minutes » | `RAPPEL` |
| `agents.modele` | `auto`, `haiku`, `sonnet`, `opus` | `auto` | workspace | Modèle des agents : « choisi par l'orchestrateur », « rapide et économique », « équilibré », « le plus capable » | l'absence de défaut |
| `agents.effort` | `auto` et `EFFORTS` | `auto` | workspace | Réflexion des agents : « choisie par l'orchestrateur », de « courte » à « maximale » | l'absence de défaut |

Total après 008 : 16 réglages, 2 presets.
