# Inventaire des commandes et des `/` (spec 004, besoin #n466)

**Relevé le** 2026-11-20. Rien ici n'est de mémoire : chaque ligne vient d'une source citée. Ce qui ne s'est pas mesuré est écrit « inconnu » ou « non mesuré ».

## Sources et versions

| Source | Version ou date | Lue comment |
|---|---|---|
| Claude Code installé sur ce Mac | `2.1.329` | `claude --version` |
| Commandes intégrées | doc officielle `https://code.claude.com/docs/en/commands` (121 lignes de tableau, dont des alias et des commandes retirées) | `curl` de la page en Markdown, 2026-11-20. La doc ne porte pas de numéro de version propre ; elle note par commande la version minimale (la plus haute lue : 2.1.288, `/restart` ; le texte des lignes longues a été tronqué à 420 caractères, une exigence plus haute peut m'avoir échappé : non vérifié) |
| Mode non interactif | `https://code.claude.com/docs/en/headless` | idem |
| Hooks | `https://code.claude.com/docs/en/hooks` | idem |
| Barre de statut | `https://code.claude.com/docs/en/statusline` | idem |
| Skills et agents de Heifara | `~/.claude/skills/`, `~/.claude/agents/`, `~/.claude/setup/` | listés et lus le 2026-11-20 ; `~/.claude/commands/` n'existe pas |
| Skills du dépôt | `skills/` (`cate-cli`, `cate-theme`, `orchestrateur`, `panneau-perso`) | lus dans ce worktree |
| Envoi à une session | `src/services/agents/runtime/terminal.ts:612-632`, `src/services/agents/runtime/status.ts:273`, `docs/architecture.md` (prompts de l'agent, usage) | lus |

Deux écarts à connaître avant d'en tirer une conclusion :

- `skills/orchestrateur/SKILL.md` du dépôt (13 936 octets) et `~/.claude/skills/orchestrateur/SKILL.md` (11 632 octets) ne sont pas la même version ; idem `cate-cli` (10 324 contre 10 626). Laquelle un orchestrateur charge est **non vérifié**.
- Les plugins `claude-md-management`, `skill-creator` et `ponytail` sont installés (`~/.claude/plugins/cache/`) ; leurs skills ne sont pas lus ici ligne à ligne, seulement leur description.

## Les quatre canaux pour lancer une commande

Toute la question du besoin tient ici : **qui peut taper `/quelquechose` dans une session, et à quel prix.**

| Canal | Ce qu'il sait faire | Ce qu'il ne sait pas faire | Preuve |
|---|---|---|---|
| **Envoi à une session** : `cate agent send --panel <id> "/cmd"` | Le runtime tient une file par agent. Un prompt sort quand l'agent peut le prendre : présent, hooks prouvés, **aucun tour en cours, aucune demande de permission en attente** (`canReceivePrompt`). Sinon il reste `queued`, jamais collé à une saisie inachevée. Un prompt qui commence par `/` compte comme livré sans attendre un tour (`/compact` et `/clear` n'en lancent pas forcément). `cate agent withdraw` reprend un prompt encore en file. | Garantir que la commande s'exécute (un dialogue ouvert par la commande bloque la saisie suivante) ; connaître le résultat (aucun retour, on mesure ensuite). | `terminal.ts:612-632`, `status.ts:273-276`, `docs/architecture.md` (« prompts ... queued, sending, failed »), `cate agent send --help` |
| **`claude -p "/skill"`** | Les skills invocables par l'utilisateur et les commandes perso s'y développent. `/config clé=valeur` y marche. | Les commandes intégrées « du terminal » (la doc exclut `/login` en exemple ; `/compact` et `/clear` ne sont pas citées comme disponibles, `/context` l'est en pratique : `measure.py` l'appelle en `-p`) ; agir sur une session qui tourne ; toute commande qui a besoin de la conversation (`/learn`). Une session `-p` paie son démarrage (voir plus bas). | `headless.md` lignes 379-380 |
| **Hook** (`PreCompact`, `PostCompact`, `Stop`, `SessionStart`, `UserPromptSubmit`) | Voir et mesurer : `PreCompact` reçoit `trigger` (`manual` ou `auto`) et peut bloquer ou ajouter des consignes au résumé (10 000 caractères au plus) ; `PostCompact` reçoit le résumé et sert aux effets de bord ; `Stop` peut refuser l'arrêt avec une raison (c'est ce que fait `/goal`). | **Taper une commande.** Aucun hook n'exécute un `/`. | `hooks.md` lignes 59-60, 301, 1059, 1211, 3397-3459 |
| **Le régisseur d'`agence`** (`agence watch`) | Processus fils du daemon, sans PTY ni panneau, une boucle par racine de dépôt. Il lit déjà à chaque tour `cate agent list` et `cate agent usage` (`un_tour`, `tools/agence/agence.py:1969-1990`) et sait émettre des effets (`close`, `notify`). C'est le seul endroit qui calcule sans jeton. | Penser. Il applique une table. | `docs/architecture.md` (« The agence panel »), `agence.py:1507` (`tick`) |

Conséquence de conception : les skills `/learn`, `/audit-config` et `/handoff` (comme `n8n-deploy`) portent `disable-model-invocation: true` (frontmatter lu). **Un modèle ne peut pas les appeler lui-même** : seule une saisie de l'humain ou un envoi de prompt les lance. L'envoi à une session est donc le canal, pas un détour.

## Coût : comment le lire

- **Démarrage d'une session neuve**, mesuré par `measure.py` le 2026-11-19 (registre `~/.claude/state/setup/ledger.jsonl`, dossier `/Users/ADFINITAS`) : 28 600 jetons visibles dans `/context` (dont `Skills` 8 500, `Memory files` 9 100, `System prompt` 3 300, `System tools` 2 500), 45 296 facturés au total exact. Le même poste dans un projet comme `cate` n'est **pas mesuré**.
- **Fenêtre** : le registre donne `Free space` 938 400 et `Autocompact buffer` 33 000, soit environ 1 M de jetons. Une part de fenêtre est donc un mauvais déclencheur : 150 000 jetons lus par tour (cas de #100) ne pèsent que 15 % de la fenêtre et coûtent déjà cher en attente. **Le seuil se compte en jetons absolus.**
- **Taille du corps d'un skill** : octets du `SKILL.md` divisés par 4, **approximation non mesurée**. Le coût réel d'un skill est celui des tours qu'il déclenche : inconnu avant mesure.
- **Coût d'un tour d'attente** : environ 140 000 jetons lus par passage (mesure de #100, 2026-11-20) ; référence plus ancienne de la mémoire de l'orchestrateur : 477 000 par tour (17/11).
- **`cate agent usage`** rend par panneau `model`, `inputTokens` (cache lu inclus, **cumulé sur la session**), `outputTokens`, `costUsd` (`null` sans prix) et `sessionIds`. Exemple lu à l'instant : orchestrateur `inputTokens` 403 248 288, `costUsd` `null`. Ce n'est **pas** la taille du contexte. La taille du contexte d'une session Claude Code est dans son journal (`~/.claude/projects/<dossier>/<session>.jsonl`) : dernier message `assistant`, `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Vérifié sur la session de cette spec : 2 + 4 122 + 162 976 = 167 100 jetons. Cate ne l'expose pas aujourd'hui (lot 1 du plan).
- **Barre de statut** : `context_window.used_percentage` et `context_window_size` existent dans son entrée JSON (`statusline.md` lignes 185-188), mais `statusLine` est `null` dans `~/.claude/settings.json` : **aucune barre de statut n'est branchée**, et ce serait un changement du setup (accord de Heifara) qui ne sert qu'à la session qui l'affiche.

## 1. Commandes intégrées de Claude Code 2.1.329

Colonnes : **Fonction** en une ligne ; **Coût** ; **Sert quand** ; **Programme** : `S` envoi à une session, `P` `claude -p`, `non` impossible ou sans intérêt (la doc cite un dialogue, un compte ou un affichage). Les `S` sont **selon la doc, non sondés** sauf les cinq du lot 0 du plan.

### Celles qui comptent pour le cercle vertueux

| Commande | Fonction | Coût en jetons | Sert quand | Programme |
|---|---|---|---|---|
| `/compact [consignes]` | Résume la conversation pour libérer du contexte | un appel qui lit tout le contexte et écrit un résumé : dollars **inconnus**, se mesure en comparant le contexte avant et après | contexte lourd avant une longue attente ; l'auto-compactage existe (vers 967 000 jetons pour les fenêtres d'1 M, `model-config.md:879`) mais arrive tard | `S` (à sonder). `PreCompact` peut le cadrer, pas le lancer |
| `/clear [nom]` | Nouvelle conversation, contexte vide | aucun appel ; le coût est le démarrage de la session suivante (28 600 visibles au 2026-11-19, hors projet) | fin de vague, changement de sujet | `S` (à sonder). Cate voit la coupure (`conversationResets.ts`) et garde la liste des sessions pour `cate agent usage` |
| `/context [all]` | Grille d'usage du contexte, conseils | affichage local ; appel au modèle **non indiqué par la doc, non mesuré** | savoir où part le contexte | `S` à sonder ; utilisé par `measure.py` en `-p` |
| `/autocompact [auto\|<jetons>]` | Fixe la taille à laquelle l'auto-compactage part | aucun appel ; **écrit les réglages utilisateur** (`modelSettings`) | abaisser le seuil de départ pour tous | non : change `~/.claude`, accord de Heifara |
| `/usage` (alias `/cost`, `/stats`) | Coût de la session, limites du forfait, activité | affichage local, non mesuré | lire les limites | `S` à sonder |
| `/goal [condition\|clear]` | Garde l'agent au travail jusqu'à une condition, évaluée par un modèle après chaque tour | **un tour plein par vérification** : c'est le mécanisme qui fait payer chaque minute d'attente dans #100 | travail autonome borné ; à éviter en attente | `S` |
| `/loop [intervalle] [prompt]` | Répète un prompt tant que la session reste ouverte | un tour par itération | surveiller sur durée | `S` |
| `/schedule` (alias `/routines`) | Tâches planifiées dans le cloud | un agent cloud par exécution ; coût du forfait | rapport récurrent hors poste | `S` |
| `/recap` | Résumé d'une ligne de la session | un appel court ; coût non mesuré | reprendre après une absence | `S` à sonder |
| `/rewind` (alias `/checkpoint`, `/undo`) | Revenir à un point de la conversation ou du code | local | annuler un dérapage | non : dialogue |
| `/branch [nom]` | Copie la conversation à ce point, bascule dessus | aucun appel ; le contexte copié est relu à chaque tour | essayer une autre voie | `S` |
| `/fork [prompt]` | Copie la conversation dans une session de fond | contexte entier relu par la copie | parallèliser un détour | `S` |
| `/subtask <tâche>` | Sous-agent forké qui hérite de toute la conversation | contexte entier relu | tâche annexe | `S` |
| `/background [prompt]` (`/bg`) | Détache la session en agent de fond (`claude agents`) | aucun | libérer le terminal | `S` ; hors du modèle « un agent = un panneau Cate » |
| `/btw [question]` | Question à côté sans entrer dans la conversation | un appel court | éviter de gonfler le contexte | `S` |
| `/resume`, `/rename`, `/export`, `/copy` | Reprendre, renommer, exporter, copier | locaux | confort | `/rename nom` et `/export fichier` : `S` ; `/resume` : non (sélecteur) |
| `/memory` | Édite les `CLAUDE.md`, active la mémoire auto | local | ranger la mémoire | non : éditeur |
| `/skills` | Liste les skills, tri par jetons, visibilité | local | voir ce que coûtent les skills | non : sélecteur |
| `/skill-doctor` | Pour chaque skill : coût en contexte et fréquence d'usage | local ; **demande la récupération des drapeaux de fonctionnalité** (`env-vars`) | trouver les skills à éteindre | `S` à sonder. Recoupe `usage.py` |
| `/insights` | Rapport HTML sur tes sessions récentes : où ça coince, fonctions à essayer | **tokens facturés au forfait** (`costs.md:127`), montant non mesuré | chercher des améliorations du processus | `S` à sonder. Sortie : un fichier HTML, à lire par l'humain |
| `/doctor [prompt-audit [chemin]]` | Bilan d'installation, réglages, extensions, `CLAUDE.md` ; `prompt-audit` audite les instructions | tours de modèle, non mesurés | après un changement du setup | `S` ; propose et applique après confirmation |
| `/team-onboarding` | Guide d'arrivée tiré de 30 jours d'usage | un appel sur l'historique, non mesuré | hors sujet pour une personne seule | `S` |
| `/fewer-permission-prompts` (skill) | Lit les transcripts, ajoute une liste blanche de commandes lecture seule dans `.claude/settings.json` du projet | tours de modèle, non mesurés | trop de demandes de permission | `S`. **Modifie un réglage de projet : accord avant l'envoi** |
| `/update-config [demande]` (skill) | Modifie `settings.json` (permission, variable, hook) | un tour | un « à chaque fois que... » durable | `S`. **Modifie le setup : accord** |
| `/init` | Crée un `CLAUDE.md` | tours de modèle | projet neuf | `S` |
| `/hooks`, `/permissions`, `/mcp`, `/config`, `/statusline` | Voir ou régler hooks, permissions, serveurs MCP, réglages, barre de statut | locaux | réglages | `/config clé=valeur` : `S` et `P` ; les autres : non (dialogue) |
| `/agents`, `/list-agents` (`/peers`) | Rappel pour gérer les sous-agents ; liste des sessions jointes | locaux | savoir qui est joignable | `S` ; redondant avec `cate agent list` |
| `/tasks` (`/bashes`) | Travail de fond de la session | local | voir les tâches en fond | non : vue |
| `/code-review [niveau] [--fix] [--comment] [pr]` (alias `/review`), `/simplify`, `/security-review`, `/ultrareview` | Revues du diff, nettoyage, sécurité, revue cloud multi-agents | **un à plusieurs agents** : coût élevé et non mesuré ; `ultra` est facturé au crédit | avant une PR | `S`. `ultrareview` : **seul l'humain** le lance (règle de la session) |
| `/diff`, `/run`, `/verify`, `/debug`, `/batch`, `/deep-research`, `/workflows`, `/claude-api`, `/dataviz`, `/design*`, `/slides`, `/artifacts`, `/artifact-*` | Outils de travail (voir le diff, lancer l'app, vérifier, déboguer, grands chantiers, recherche, API Claude, graphiques, maquettes, artefacts) | selon la commande, non mesuré | travail, pas amélioration du processus | `S` ou non selon le dialogue ; `/run` et `/verify` ouvrent l'app : **interdits aux agents** (règle du projet) |
| `/plan [description]` | Entre en mode plan | aucun | cadrer avant d'agir | `S` |
| `/model`, `/effort`, `/fast`, `/advisor` | Modèle, effort, mode rapide, conseiller | locaux ; **changer de modèle ou d'effort change le coût de chaque tour suivant** | adapter le coût à la tâche | avec argument : `S` ; sans : sélecteur. Le modèle d'un agent se règle au lancement (`cate agent start --model`) |

### Les autres (réglage, compte, affichage, intégrations)

Aucun ne sert une amélioration du processus. Coût : **non mesuré**, la doc n'y décrit aucun tour de modèle sauf mention contraire. Programme : non, sauf mention.

| Commande | Fonction |
|---|---|
| `/add-dir` | Ajoute un dossier lisible |
| `/auto-mode-setup` | Rédige `autoMode.environment` depuis le projet et les sessions récentes (tours de modèle) |
| `/autofix-pr` | Session cloud qui surveille la PR de la branche |
| `/bug`, `/feedback` | Envoyer un retour (écran de consentement) |
| `/cd` | Déplace la session dans un autre dossier |
| `/chrome`, `/claude-in-chrome` | Claude in Chrome |
| `/color`, `/theme`, `/tui`, `/focus`, `/scroll-speed`, `/terminal-setup`, `/keybindings`, `/output-style` | Apparence et saisie (`/color`, `/rename` aussi en `-p`) |
| `/desktop` (`/app`), `/mobile`, `/ide`, `/remote-control` (`/rc`), `/remote-env`, `/teleport` (`/tp`), `/web-setup` | Passerelles vers d'autres surfaces |
| `/exit` (`/quit`), `/stop`, `/restart` (`/update`) | Quitter, arrêter une session de fond, redémarrer |
| `/heapdump`, `/status`, `/release-notes`, `/help`, `/powerup`, `/radio`, `/stickers` | Diagnostic, aide, divers |
| `/import` | Importe la config de Codex, Gemini ou Cursor |
| `/install-github-app`, `/install-slack-app` | Installation d'apps |
| `/login`, `/logout`, `/privacy-settings`, `/passes`, `/upgrade`, `/usage-credits`, `/rate-limit-options` | Compte et forfait |
| `/plugin`, `/plugin-authoring`, `/reload-plugins`, `/reload-skills` | Plugins et rechargement des skills (`/reload-skills` sert après la création d'un skill) |
| `/run-skill-generator`, `/design-login`, `/design-sync`, `/design consent`, `/design revoke` | Fabrique de skills `run`, accès Claude Design |
| `/sandbox`, `/voice`, `/pr-comments` (retiré en 2.1.91), `/ultraplan` (retiré), `/vim` (retiré en 2.1.92), `/workflow-authoring` | Divers et retirés |

## 2. Skills et commandes de Heifara (`~/.claude/`)

`~/.claude/commands/` n'existe pas : tout passe par des skills. Le poste `Skills` de 8 500 jetons au démarrage (registre du 2026-11-19) est la somme des descriptions ; le coût par skill n'est pas mesuré (`/skill-doctor` le donnerait).

| `/` | Octets du corps (÷4 ≈ jetons, approximation) | Fonction | Sert quand | Programme |
|---|---|---|---|---|
| `/learn` | 2 775 (≈ 700) | Cure un apprentissage : mémoire, `CLAUDE.md`, rule, skill ou abandon, sans doublon ; **une confirmation avant toute écriture** | fin de session substantielle, après un piège coûteux, après une PR mergée | `S` en session (il lit la conversation) ; `disable-model-invocation: true` ; pas utile en `-p` |
| `/audit-config` | 2 430 (≈ 600) | Audit de la config par l'usage réel et le coût de contexte, ménage classé par gain, **une confirmation par élément**, sauvegarde d'abord. Lance `usage.py`, `measure.py` (≈ 0,02 $) et `check.py --full` | une fois par mois, ou contexte de départ lourd | `S` ; `-p` possible pour la liste proposée, pas pour les confirmations ; `disable-model-invocation: true` |
| `/handoff` | 2 216 (≈ 550) | Arbre git propre, récap de 8 lignes, prompt de reprise, diff à porter | avant `/clear` ou changement de projet | `S` ; `disable-model-invocation: true` |
| `/n8n-deploy` | 2 311 | Déploiement n8n | hors cercle | non |
| `/bus` | 3 078 | Bus pub/sub entre sessions | coordination, hors cercle | `S` |
| `/orchestrateur` | 11 632 (global) ou 13 936 (dépôt) | Orchestre un projet sur le canvas Cate | lancement d'un projet | `S` |
| `/cate-cli` | 10 626 (global) ou 10 324 (dépôt) | Pilote Cate depuis un terminal | tout travail dans Cate | chargé par l'agent |
| `/graphify` | 50 920 (≈ 12 700, **le plus lourd**) | Graphe de connaissances d'un dépôt | question d'architecture ; régénérer après un gros ajout de modules | `S` ; `graphify-out/` n'existe pas dans ce worktree |
| `/ways-of-working` | 14 330 | Façon de travailler de Heifara | avant de rédiger en son nom | chargé par le skill-guard |
| `/design-taste-frontend` | 30 970 | Front sans « slop » | travail front | hors cercle |
| `/pr`, `/pr-review`, `/issue` | 5 018, 2 621, 7 581 | Livrer une PR, relire, rédiger une issue | cycle de livraison | `S` |
| `/diagnosing-bugs`, `/sync-incident`, `/gcp-cost-review`, `/point-dg`, `/suivi-dev`, `/cartographie-leads`, `/livrables-front`, `/hermes`, `/max`, `/stop-slop`, `/brag-slim` | 1 315 à 11 376 | Skills métier ou ponctuels | à la demande | hors cercle |
| `/panneau-perso`, `/cate-theme` (dépôt) | 9 100, 5 900 | Panneaux perso, thèmes Cate | à la demande | hors cercle |
| `tooling-scout` (**agent**, `~/.claude/agents/tooling-scout.md`, 2 999 octets) | | Cherche des automatisations : MCP, hooks, skills, agents ; **3 recommandations au plus**, chacune avec la raison observée, l'impact, la commande d'installation et la portée | une même friction revient ; flux répétitif ou lent | **Pas par l'outil Agent** dans un terminal Cate (`cate-guard`, règle « un agent est un panneau ») : `cate agent start` avec un brief, qui lui donne la sortie de `usage.py` en entrée. Outils de l'agent : `Read, Grep, Glob, WebSearch, WebFetch` |

Skills de plugins et fournis, utiles au cercle : `skill-creator:skill-creator` (créer, mesurer, optimiser un skill, avec `evals`), `claude-md-management:claude-md-improver` (audit des `CLAUDE.md`, rapport de qualité puis mises à jour ciblées) et `claude-md-management:revise-claude-md` (mettre à jour un `CLAUDE.md` avec ce que la session a appris), `ponytail:ponytail-audit` (audit de sur-ingénierie du dépôt entier, rapport sans correction), `ponytail:ponytail-debt` (registre des raccourcis), `update-config`, `fewer-permission-prompts`. Tous : tours de modèle, coût non mesuré ; tous `S`.

## 3. Outils de mesure (`~/.claude/setup/`)

| Outil | Fonction | Coût | Appel au modèle | Programme |
|---|---|---|---|---|
| `check.py` (18 326 octets) | Tests du setup : skills (limite de description 1 024, budgets 10 000 global et 15 000 projet), hooks et leurs cas, mémoire, `CLAUDE.md`. Sortie 1 si un test échoue. `--full` ajoute plugins en échec et MCP non connectés (lent) | aucun jeton ; durée non mesurée | **non** | oui, script local, lecture seule |
| `measure.py` (6 868 octets) | Contexte de départ d'une session et écart avec la mesure précédente, consigné dans `~/.claude/state/setup/ledger.jsonl` | **≈ 0,02 $ la mesure** (en-tête du script) : deux appels `-p` sur haiku | **oui** | oui, mais **jamais dans une boucle** : il paie un appel |
| `usage.py` (14 449 octets) | Usage réel lu dans les transcripts : skills, `/` tapés, MCP, sous-agents, skills sans usage, erreurs d'outils, commandes Bash répétées, guards déclenchés, taux de correction ; `--tokens` donne jetons par session et « lu par tour » ; `--ledger` cumule | aucun jeton ; durée non mesurée (319 transcripts sur 45 jours au dernier passage) | **non** | oui, lecture seule. Le registre `usage-ledger.jsonl` garde `skills`, `slash`, `mcp`, `agents`, `guards`, `kpi` (`prompts`, `corrections`, `tool_calls`, `tool_errors`) ; **les erreurs et commandes répétées ne sont que dans la sortie texte** |

Dernier passage connu de `usage.py` (2026-11-11, 45 jours, 319 transcripts) : 970 prompts, 12 corrections, 21 566 appels d'outils, 1 468 erreurs d'outils ; guards déclenchés : `no-emdash.sh` 29, `git-guard.sh` 12.

## 4. Skills du dépôt (`skills/`, livrés dans le runtime)

| Skill | Octets | Fonction | Lien avec cette spec |
|---|---|---|---|
| `orchestrateur` | 13 936 | CLI `agence` : lancer, relier, suivre, faire valider par clic | **Reçoit la règle des déclencheurs** (lot 5 du plan) |
| `cate-cli` | 10 324 | `cate` : navigateur, terminal, éditeur, agents | Décrit `cate agent send`, `wait`, `usage` ; `references/agents.md` |
| `panneau-perso` | 9 100 | Panneaux perso | Aucun |
| `cate-theme` | 5 900 | Thèmes | Aucun |

## 5. Ce que l'inventaire change pour la spec

1. **`/compact` est le seul `/` dont l'effet est mesurable tout de suite** (le contexte avant et après), et le seul que #100 attend. Il ouvre la liste.
2. **`/learn`, `/audit-config` et `/handoff` ne se lancent que par saisie** : l'envoi à une session est le seul canal.
3. **Aucun hook ne peut taper une commande.** Les hooks servent à mesurer ou à cadrer (`PreCompact`), pas à lancer ; installer un hook est de plus un changement de `~/.claude/settings.json`, que Cate n'écrit jamais.
4. **La taille du contexte n'est pas dans `cate agent usage`.** Elle est dans le journal de session ; il faut un champ de plus côté Cate (lot 1).
5. **`measure.py` coûte un appel ; `usage.py` et `check.py` n'en coûtent aucun.** Un déclencheur décide avec les deux derniers et lance `measure.py` seulement à l'intérieur d'une commande acceptée.
6. **La mesure de consommation (`common/tools/conso.py`, dépôt Skills) coûte 0 jeton et sort des nombres seulement.** Dépendance externe, non inventoriée ici : un déclencheur hebdomadaire (T11, q488) la lance au clic, sans la lire.
