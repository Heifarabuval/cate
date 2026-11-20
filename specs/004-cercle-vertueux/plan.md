# Implementation Plan: Cercle vertueux

**Branch**: `docs/spec-cercle-vertueux` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Inventaire**: [inventaire.md](inventaire.md)

**Input**: issue #103. Spec seule dans cette PR ; l'issue reste ouverte pour l'implémentation. Aucun code ici.

## Summary

Le régisseur de l'agence (`agence watch`, un par racine de dépôt) lit déjà à chaque tour `cate agent list` et `cate agent usage`, tient l'état des besoins et sait envoyer un message à un panneau (`notify` = `cate agent send`). On lui ajoute **un évaluateur** : une fonction pure qui lit une table de déclencheurs (un fichier de données) et rend des décisions. Une décision est soit un envoi de commande (classe A, `/compact` seulement), soit une carte dans le panneau agence qui attend le clic de Heifara (classe B), soit rien. Chaque décision laisse une ligne au journal, avec la mesure avant ; le tour d'après ajoute la mesure après et un verdict. `agence declencheurs bilan` rend le taux de réussite par commande et propose de réviser un seuil. Aucun tour de modèle ne décide : 0 jeton de surcoût, 0 € de service.

Un seul ajout de code côté Cate : `cate agent usage` rend `contextTokens` (la taille du contexte au dernier tour), seule donnée qui manque (le cumul `inputTokens` n'est pas la taille du contexte, voir inventaire).

| Sujet | Recommandé | Taille | Coût mensuel |
|---|---|---|---|
| Où vit l'évaluateur | Le régisseur d'`agence` (`tools/agence/agence.py`), une fonction pure `evaluer(instantane)` testée seule ; table dans `tools/agence/declencheurs.json` (livrée au runtime : `scripts/agence-files.mjs` copie tout sauf tests, fixtures et fichiers cachés) | lot 2 | 0 € |
| Comment envoyer une commande | `cate agent send --panel <id> "<cmd>"` ; jamais `cate terminal type` | lot 3 | 0 € |
| Donnée « taille du contexte » | Champ `contextTokens` de `cate agent usage` (contrat et moteur d'usage de `services/agents`) | lot 1 | 0 € |
| Carte de validation | Une question de l'état de l'agence avec une action `cmd:<commande>@<panneau>`, comme `merge:owner/repo#N` ; au clic le régisseur envoie | lot 3 | 0 € |
| Journal | JSONL par jour dans `<racine>/.cate/tmp/agence/declencheurs/`, 90 jours, un seul écrivain | lot 2 | 0 € |
| Premier mode | **À blanc** : l'évaluateur décide et journalise, rien ne part, jusqu'à ce que Heifara active une commande | lot 2 | 0 € |
| Hook | Aucun (un hook ne tape pas de commande ; en installer un touche `~/.claude`) | | 0 € |

## Technical Context

**Language/Version**: Python 3.9+ stdlib pour l'évaluateur, le journal, le bilan (`tools/agence/`, `npm run test:agence`) ; TypeScript strict pour `contextTokens` (`src/services/agents/`).

**Primary Dependencies**: aucune ajoutée.

**Storage**: `<racine>/.cate/tmp/agence/declencheurs/<AAAA-MM-JJ>.jsonl` (ajout seul, `0600`, dossier `0700`) ; l'état des cartes et des commandes muettes dans `<racine>/.cate/tmp/agence/state.json` (la CLI en est l'écrivain unique). Rien dans `~/.claude`, rien dans `~/.cate` global. Lecture seule optionnelle de `~/.claude/state/setup/ledger.jsonl` et `~/.claude/state/usage-ledger.jsonl` (FR-013).

**Testing**: `unittest` (`tools/agence/test_declencheurs.py`, instantanés JSON fabriqués, horloge simulée) ; Vitest pour `contextTokens`. Tout test qui écrit des fichiers tourne dans un dossier temporaire et échoue s'il voit le vrai `~/.cate` ou `~/.claude`. Aucun e2e, aucune fenêtre (constitution X) : l'action réelle (recette) est à Heifara.

**Target Platform**: macOS Apple silicon (principe VIII).

**Project Type**: desktop-app (fork) + CLI embarquée.

**Constraints**: couches et côtés (`lint:deps`) ; un seul écrivain par fichier ; coupes nettes ; écart minimal avec upstream (principe IX) : l'agence est propre au fork ; `contextTokens` est un champ ajouté à un contrat existant.

**Scale/Scope**: un utilisateur, un à quatre agents, un tour de régisseur toutes les quelques secondes ; quelques dizaines de décisions par semaine au plus.

## Constitution Check

| Principe | Vérification | État |
|---|---|---|
| I. Couches et côtés | `contextTokens` : contrat pur dans `services/agents/contract/usage/`, calcul dans le moteur d'usage côté `runtime/` ; l'évaluateur est dans `tools/agence/`, hors `src/`, et ne parle à Cate que par la CLI `cate` | OK, `lint:deps` au lot 1 |
| II. Déclarer une fois | table des déclencheurs dans un seul fichier de données ; `contextTokens` déclaré dans le contrat d'usage et lu par le moteur générique ; `agence declencheurs` apparaît dans l'aide de la CLI | OK |
| III. Coupes nettes | module neuf, aucune ancienne forme lue ; l'état de l'agence gagne une clé, les états écrits avant ne l'ont pas (lecture avec `.get`, comme `journal`) | OK |
| IV. Pas de branchement sur le contexte | aucun `if local` ; la table porte `agentId` comme donnée, pas comme branche ; le régisseur parle à `cate`, qui parle à n'importe quel runtime | OK |
| V. Le runtime est l'application | le régisseur est un processus fils du daemon (comme aujourd'hui) ; la vue ne décide rien : elle affiche la carte et poste le clic | OK, écart assumé : la logique vit dans `tools/agence/`, comme la spec 002 |
| VI. Tests d'abord | chaque tâche de code a sa tâche de test rouge avant (tasks.md) ; « jamais » avant écriture | OK |
| VII. Le plus simple | JSONL, une table, une fonction pure ; pas de base, pas de modèle, pas de file | OK |
| VIII. macOS seul | aucun cas Linux ni Windows | OK |
| IX. Écart minimal avec upstream | `contextTokens` : un champ ; le reste est dans `agence`, propre au fork | OK |
| X. Aucune fenêtre lancée par un agent | sondes du lot 0 sur un agent jetable en panneau (comme tout agent lancé par `cate agent start`), jamais l'app, jamais Playwright | OK ; la recette réelle est à Heifara |

## Mécanisme

### Où vit chaque déclencheur

| Pièce | Où | Pourquoi là |
|---|---|---|
| Table (commande, condition, seuil, classe, repos, plafond, indicateur) | `tools/agence/declencheurs.json` | une déclaration, lue par l'évaluateur, le bilan et l'aide ; un changement de seuil = une ligne de données, un test |
| Évaluateur `evaluer(instantane) -> decisions` | `tools/agence/agence.py` (fonction pure, à côté de `tick`) | il reçoit ce que `un_tour` lit déjà : agents, usage, besoins, journal, horloge |
| Lecture de la donnée | `un_tour` : `cate agent list` (état, `canReceivePrompt`, `prompts`), `cate agent usage` (maintenant avec `contextTokens`) | une lecture par tour, déjà faite ; refus de Cate : le déclencheur se tait et le dit |
| Envoi | un effet `('send', panneau, commande, id)` appliqué par `apply`, qui appelle `cate agent send` | même chemin que `notify`, donc même file et mêmes refus |
| Carte | une question de `st['questions']` avec `action: "cmd:<commande>@<panneau>"` ; au clic sur l'option 0, le régisseur envoie | précédent exact : `merge:owner/repo#N` (`cmd_ask`, `click`) |
| Journal et bilan | `tools/agence/agence.py` : `declencheurs bilan`, purge au démarrage et une fois par jour | un seul écrivain, même dossier que l'état |
| Règle pour l'orchestrateur | `skills/orchestrateur/SKILL.md`, section « Déclencheurs » (lot 5) | il sait ce que le régisseur fait seul et ce qu'il ne fait pas |
| Hook | aucun au départ | aucun hook ne tape un `/` ; un `PreCompact` pour cadrer le résumé est une option qui demande `agence hooks install` et l'accord de Heifara |

### Envoyer une commande à une session sans l'interrompre

1. **Un seul canal : `cate agent send --panel <id> "<commande>"`.** Le runtime tient la file de chaque agent (`queued`, `sending`, `failed`) : le prompt sort quand l'agent est présent, ses hooks prouvés, **aucun tour en cours, aucune permission en attente** (`canReceivePrompt`, `status.ts:273`), et jamais collé à une saisie inachevée. Cela vaut pour un `/` (`terminal.ts:622-625` : un prompt qui commence par `/` compte comme livré sans attendre un tour).
2. **Jamais `cate terminal type` ni `press` sur un agent.** C'est la règle de l'orchestrateur (« tu ne réponds jamais à sa place ») et FR-003. Un agent bloqué sur une confirmation se règle dans le panneau, par l'humain.
3. **L'envoi ne refuse jamais un agent occupé, il met en file.** Pour une commande qui détruit ou résume le contexte (`/compact`, `/clear`), mettre en file derrière un tour est faux : elle partirait à un moment que l'évaluateur n'a pas vu. Donc : relire `cate agent list` juste avant, n'envoyer que si `state` = `waitingForInput`, `canReceivePrompt` vrai et `prompts` vide (FR-004) ; sinon `attendre`. Si la condition tombe après un envoi encore en file, `cate agent withdraw` reprend le prompt.
4. **Pour une commande de classe B** (`/learn`, `/audit-config`), la mise en file est voulue : le clic de Heifara est l'ordre, la carte dit « en file » tant que l'agent travaille ou attend une permission. Elle part à la fin du tour, jamais pendant.
5. **Une commande n'est pas une preuve d'exécution.** Le runtime ne voit pas ce qu'elle fait ; le verdict se lit sur la mesure (contexte, besoin, réponse) : c'est le rôle du journal.
6. **Dialogue ouvert par une commande** : un `/` à sélecteur bloquerait la saisie suivante sans que le runtime le signale (il exempte les `/` de l'attente d'un tour). La table ne contient donc que des commandes sondées au lot 0 comme sans dialogue.

### Couches, règle « les agents ne tapent pas dans le terminal d'un agent bloqué », vie privée

- Le régisseur n'est pas un agent : sans PTY, sans panneau, avec le jeton de la CLI. Il envoie par la capability `agents.send`, la même que tout client. L'orchestrateur (un modèle) **n'envoie pas** `/compact` à un autre agent et ne tape dans aucun terminal : sa règle reste celle du skill.
- `contextTokens` reste dans `services/agents` (moteur d'usage). L'agence ne lit pas `~/.claude/projects/`.
- Le journal ne porte que des codes et des nombres (FR-007) ; il ne quitte pas le Mac ; aucun modèle ne lit ses lignes brutes (FR-016).

## Table des déclencheurs

Tous les seuils sont des **hypothèses à mesurer** (colonne « Seuil de départ ») : aucun n'est une mesure, sauf le contexte de #100 qui motive le premier. « Qui lance » : le **régisseur** évalue et envoie ou pose la carte ; **Heifara** clique pour la classe B ; **l'orchestrateur** ne lance rien lui-même.

Garde-fous communs à toutes les lignes : l'évaluateur est une fonction pure (0 jeton) ; jamais d'envoi à un agent en plein tour ou bloqué sur une confirmation pour une commande de contexte ; jamais de changement du setup sans accord (règle « créer à la demande ») ; délai de repos et plafond de 3 envois par panneau et par jour ; « Plus pour cette commande » ; mode à blanc tant que Heifara n'a pas activé la commande.

| ID | Commande | Condition | Donnée qui décide | Seuil de départ (hypothèse à mesurer) | Qui lance | Classe | Garde-fous propres | Indicateur de réussite |
|---|---|---|---|---|---|---|---|---|
| T1 | `/compact` | l'orchestrateur est au repos (`waitingForInput`, file vide) et son contexte dépasse le seuil | `cate agent usage` : `contextTokens` ; `cate agent list` : `state`, `canReceivePrompt`, `prompts` | 150 000 jetons (motif : ~140 000 lus par passage dans #100) ; repos 10 min | régisseur | A (sous Q1) | agent au repos et file vide relus avant l'envoi ; consigne de `/compact` : garder besoins ouverts, panneaux, décisions ; `agence boot` rend l'état après | `contextTokens` après ≤ 50 % de l'avant au 2e tour suivant ; échec ≥ 80 % |
| T2 | `/learn` | un besoin passe à `done` par `pr-merged:N` | état de l'agence (besoin `done`, `doneWhen`), GitHub (`gh`, déjà lu) | immédiat, une carte par besoin, expire à 48 h | régisseur pose la carte, Heifara clique | B | une carte par besoin ; le skill demande lui-même sa confirmation avant d'écrire ; session cible : l'orchestrateur (Q3) | réponse « enregistrer », « améliorer » ou « absorber » dans les 30 min ; « abandonner » ou rien : échec |
| T3 | `/audit-config` | 7 jours sans exécution et aucun agent en plein tour | date de la dernière ligne du journal ; dernier total exact de `~/.claude/state/setup/ledger.jsonl` (lecture seule) | 7 jours ; carte expire à 7 jours | régisseur pose la carte, Heifara clique | B | ne lance jamais `measure.py` (un appel, ≈ 0,02 $) : c'est le skill qui le fait ; aucune édition de `permissions` ni d'`autoMode` (règle du skill) | un candidat accepté dans les 7 jours, lu comme un nouveau total exact plus bas dans le registre |
| T4 | `/clear` (le « `/new` » de l'issue) | la vague est finie (plus de besoin ouvert) et le contexte dépasse le seuil | état de l'agence (`need list --open` vide), `contextTokens` | contexte ≥ 100 000 et 0 besoin ouvert | régisseur pose la carte | B | carte seulement : un `/clear` perd le fil ; `agence boot` rend les décisions ; jamais si un prompt est en file | `contextTokens` après ≤ 30 000 ; le besoin suivant démarre sans question répétée (non mesurable seul : `sans-mesure` sur ce point) |
| T5 | `tooling-scout` (agent en panneau) | une même friction revient dans 2 passages d'`usage.py` | `usage.py` (lecture seule, 0 jeton) : commande Bash retapée, erreur d'outil, garde déclenché ; **à normaliser** (Q9) | 2 passages sur 7 jours | régisseur pose la carte, Heifara clique | B | `cate agent start` avec un brief ; jamais l'outil Agent ; une place libre sur les 4 agents ; il ne modifie rien (outils `Read, Grep, Glob, WebSearch, WebFetch`) | au moins une des 3 recommandations retenue par Heifara |
| T6 | `skill-creator` | la même séquence revient 2 fois | idem T5 | 2 occurrences | carte | B | confirmation et évals du skill ; `check.py` à 0 échec ensuite | un skill créé qui passe ses évals |
| T7 | `/fewer-permission-prompts` | beaucoup de demandes de permission sur un projet | nombre de demandes de permission lues par l'agence (`perm` des besoins) sur 7 jours | 10 demandes sur 7 jours | carte | B | écrit `.claude/settings.json` du projet : **accord avant l'envoi** et relecture de la liste | baisse du nombre de demandes sur les 7 jours suivants |
| T8 | `claude-md-improver` | un `CLAUDE.md` a bougé plusieurs fois depuis le dernier audit | `git log` du dépôt (commits touchant `CLAUDE.md`) | 5 commits ou 30 jours | carte | B | rapport de qualité d'abord, mises à jour ciblées après confirmation | une mise à jour acceptée |
| T9 | `graphify` | beaucoup de fichiers ajoutés dans `src/` depuis le dernier graphe | `git diff --diff-filter=A` depuis la date de `graphify-out/` ; sans `graphify-out/` (cas de ce worktree), le déclencheur se tait | 20 fichiers ajoutés | carte | B | régénération coûteuse (skill de 50 920 octets) : carte seulement | graphe régénéré et consulté |
| T10 | `update-config` | une recommandation de T5 nomme un hook ou un réglage | sortie de `tooling-scout` (carte, pas de lecture automatique) | aucune condition propre | Heifara, depuis la carte de T5 | B | modifie `settings.json` : **accord** et sauvegarde ; jamais seul | réglage ajouté et `check.py` à 0 échec |

**Les trois déclencheurs minimaux** (Q2, hypothèse « Recommandé ») : **T1, T2, T3**. Ils couvrent le contexte (#100), l'apprentissage vers la mémoire et le ménage du setup. T4 est la variante de Q2 ; T5 à T10 demandent de normaliser les données de friction (Q9) et viennent après les trois premiers bilans.

## Boucle de mesure

1. **Une ligne par décision** qui n'est pas `rien`, au journal du jour : `{ts, commande, classe, decision, panneau, raison, avant, apres, verdict}`. `raison` : code d'une liste fermée (`ctx>=150000`, `merge:N`, `7j`, `friction:2`) avec ses nombres, jamais un texte libre. `avant` et `apres` : `{contextTokens, inputTokens, outputTokens, costUsd}`, chaque champ pouvant être `null`.
2. **À blanc d'abord.** Tant que Heifara n'a pas activé une commande (carte « Activer `/compact` pour ce projet »), l'évaluateur écrit `decision: "blanc"` avec la mesure avant et ce qu'il aurait envoyé. Après une à deux semaines, le bilan dit combien de fois le seuil aurait joué et à quel contexte : le seuil se règle sur des données avant que la moindre commande parte.
3. **Le verdict se calcule deux tours plus tard** (FR-009) : le régisseur relit la mesure du panneau et écrit `apres` et `verdict` sur la ligne. Sans mesure (agent fermé, `contextTokens` nul) : `sans-mesure` avec un code de raison, une fois par jour au plus.
4. **Le bilan** (`agence declencheurs bilan [--jours N] [--json]`) rend par commande : nombre de décisions, réussites, échecs, ignorées, refusées, gain médian de la mesure principale. Sans identifiant de panneau ni ligne brute.
5. **Révision des seuils** : une commande avec ≥ 3 échecs sur ses 5 derniers déclenchements fait écrire une proposition chiffrée (« seuil de `/compact` : 150 000 vers 190 000, 4 échecs sur 5 »). Elle ne s'applique pas : Heifara change la ligne de données (un commit) ou dit non. Une commande à 5 « Pas utile » de suite est proposée à la désactivation, jamais désactivée seule.
6. **Vie privée.** Même limite que la spec 003 : local, rien hors de nos outils, rien vers un modèle. Plus restreint que 003 sur ce qui entre (aucun geste, aucune adresse, aucun texte), plus long sur la durée (90 jours contre 14, parce qu'un seuil se révise sur des semaines). Rétention par le nom du fichier. L'accord n'est pas un écran : le cercle n'observe que ce que l'agence tient déjà (agents, besoins, usage).

## Couverture de la spec

| Exigence | Où | Test | Lot |
|---|---|---|---|
| FR-001, FR-014 | `evaluer()` pure dans `agence.py` | `test_declencheurs.py` : aucune importation de modèle, `claude`, `measure.py`, `cate terminal` (grep) ; instantanés fabriqués | 2 |
| FR-002 | `tools/agence/declencheurs.json` | `test_declencheurs.py` (schéma, hypothèse marquée, une ligne par commande) | 2 |
| FR-003, FR-004 | effet `send` et relecture de l'état avant l'envoi | `test_declencheurs.py` : agent en tour, permission, file non vide, repos : 0 envoi ; `cate terminal type` jamais appelé | 3 |
| FR-005, FR-006 | classe dans la table ; une commande de setup en A est refusée au chargement | `test_declencheurs.py` | 2, 3 |
| FR-007, FR-008 | journal, purge | `test_declencheurs.py` : état neuf 0 fichier ; J-89, J-90, J-91 ; nom invalide ignoré | 2 |
| FR-009, FR-010 | verdicts, bilan | `test_declencheurs.py` : journal fixture, taux, gain médian, révision à 3 échecs sur 5 | 2, 3 |
| FR-011 | carte de proposition d'un déclencheur | `test_declencheurs.py` : aucune écriture dans la table ni le setup | 5 |
| FR-012 | `contextTokens` dans `cate agent usage` (`src/services/agents/contract/usage/types.ts`, `runtime/usage/`) | `runtime/usage/usage.test.ts` (transcript fixture, valeur attendue, `null` sans comptage) ; `src/cli/engine.test.ts` si l'aide change | 1 |
| FR-013 | lectures seules des registres | `test_declencheurs.py` : registres absents, déclencheur muet | 2 |
| FR-015 | repos, plafond, mute, anti-doublon | `test_declencheurs.py` : rafale de 100 instantanés identiques = 1 décision | 2, 3 |
| FR-016 | bilan agrégé | `test_declencheurs.py` : aucune ligne brute ni id dans la sortie | 2 |
| FR-017 | `npm run lint:deps` ; vue des cartes dans le panneau agence | CI ; test de la vue de l'agence (cartes) | 1, 3 |
| FR-018 | `package.json` inchangé | revue du diff | chaque lot |
| FR-019 | `skills/orchestrateur/SKILL.md` | relecture ; test de l'aide | 5 |

## Project Structure

### Documentation

```text
specs/004-cercle-vertueux/
├── spec.md
├── plan.md          # ce fichier
├── tasks.md
└── inventaire.md    # relevé vérifié des commandes, skills, outils et canaux
```

`inventaire.md` joue le rôle d'un `research.md` (la spec 002 en a un) : un relevé de faits sourcés, pas une décision. `data-model.md` n'est pas créé : le modèle tient dans spec.md (Key Entities).

### Source Code (à écrire)

```text
tools/agence/
├── agence.py                  # evaluer(), effet send, journal, purge, bilan, carte cmd:, commande « declencheurs »
├── declencheurs.json          # la table (FR-002)
└── test_declencheurs.py       # unittest : instantanés, horloge simulée, journal fixture
src/services/agents/
├── contract/usage/types.ts    # + contextTokens
└── runtime/usage/             # + calcul du dernier contexte (parseur de lignes déjà présent)
src/shells/desktop/ui/panels/agence/   # QuestionCard.tsx : la carte « cmd: » s'affiche comme une question (un libellé, un test de plus)
skills/orchestrateur/SKILL.md  # section « Déclencheurs » (lot 5)
skills/cate-cli/references/agents.md   # contextTokens dans `cate agent usage`
docs/architecture.md           # usage (contextTokens), agence (évaluateur, journal)
CLAUDE.md                      # une ligne : journal des déclencheurs
```

**Structure Decision**: aucun module nouveau dans `src/`. La logique est dans la CLI `agence`, qui tient déjà l'état des besoins, la boucle et l'envoi ; `src/` ne gagne qu'un champ d'usage. Le contrat du journal tient dans spec.md ; il passe dans `docs/architecture.md` au lot 5.

## Lots (une PR chacun, livrable seule)

| Lot | Contenu | Taille | Dépend de | Preuve |
|---|---|---|---|---|
| 0. Sondes | (a) `cate agent send "/compact"`, `"/clear"`, `"/context"`, `"/learn"`, `"/audit-config"` sur un **agent jetable en panneau** (jamais l'app, jamais l'orchestrateur) : part, s'exécute, ouvre-t-il un dialogue, que devient l'état ; (b) `contextTokens` calculé depuis le journal de session égale le contexte que Heifara lit dans `/context` (action de Heifara) ; (c) l'agence reçoit-elle l'état `waitingForInput` et `canReceivePrompt` à temps pour FR-004 ; (d) `usage.py` : durée d'un passage, forme de la sortie | 0,5 j | Q1 et Q2 | `rapport-lot-0.md` ; table réduite aux commandes sondées |
| 1. Contexte | `contextTokens` dans `cate agent usage` (contrat, moteur, aide, doc) | 1,5 j | 0 | `usage.test.ts` vert ; `lint:deps` vert |
| 2. Évaluateur, journal, bilan (à blanc) | `declencheurs.json`, `evaluer()`, journal, purge, verdicts, `agence declencheurs bilan`, mode à blanc | 2 j | 1 | `test_declencheurs.py` : rouge d'abord, puis vert ; 0 fichier à l'état neuf ; rafale de 100 = 1 décision |
| 3. Envoi de T1 et cartes | effet `send`, relecture avant envoi, `withdraw`, carte `cmd:`, activation par carte, verdict de T1 | 2 j | 2, Q1 | tests FR-003, FR-004 ; recette sur instantanés |
| 4. T2 et T3 | cartes `/learn` après merge et `/audit-config` hebdomadaire, verdicts | 1,5 j | 3 | tests des deux cartes ; lecture seule des registres |
| 5. Règle et docs | section « Déclencheurs » du skill orchestrateur, `docs/architecture.md`, `CLAUDE.md`, `skills/cate-cli/references/` | 1 j | 4 | relecture ; `check.py` non concerné (aucun changement de `~/.claude`) |
| X. Recette réelle | un orchestrateur réel, une semaine à blanc puis `/compact` activé, le bilan lu | 0,5 j puis une semaine | 5 | action de Heifara, rapport dans #103 |

Total estimé : 9 j d'agent plus la semaine de mesure. Coût mensuel : 0 €. Les jours sont des estimations, aucun lot n'est lancé sans décision de Heifara. Le lot 1 (TypeScript) et le lot 2 (Python) touchent des fichiers différents : deux implémenteurs en parallèle possibles après le lot 0, un vérificateur différent de l'implémenteur à chaque lot, **4 agents Claude à la fois au plus** (plafond du Mac).

### Écart avec l'issue

- L'issue demande des déclencheurs qui **lancent**. Le plan livre d'abord un mode **à blanc** : l'évaluateur décide et journalise sans rien envoyer, pour que le seuil se règle sur des données avant qu'une commande parte. C'est plus lent d'une semaine et moins risqué ; Heifara peut activer une commande dès le lot 3.
- L'issue place `/learn` « après une PR mergée » et `/audit-config` « chaque semaine » dans la table ; le plan les met en **classe B** (une carte) parce qu'elles changent des fichiers de la mémoire et du setup (règle « jamais sans accord »), même si le skill demande sa propre confirmation.
- L'issue dit « `/new` » ; pour Claude Code c'est `/clear` (voir spec, Clarifications).
- Les `/` de recherche de skills (T5 à T10) sont dans la table pour que Heifara les voie, mais **hors des trois premiers lots** : leur donnée (friction normalisée) n'existe pas encore.

## Risques

| Risque | Effet | Parade |
|---|---|---|
| `/compact` envoyé par `cate agent send` ne s'exécute pas (dialogue, saisie perdue) | commande sans effet, journal faux | lot 0 ; le verdict se lit sur la mesure, pas sur l'envoi ; `sans-mesure` motivé |
| `contextTokens` ne reflète pas ce que Claude Code facture (cache, outils différés) | seuil faux | lot 0 (b) : comparaison à `/context` par Heifara ; le seuil est une hypothèse mesurée, pas une loi |
| Rafale de décisions (l'état change à chaque tour) | boucle | repos, plafond, test de rafale (M1) |
| `/compact` perd un état qui n'était qu'en tête de l'orchestrateur | décision perdue | état dans `agence need` ; consigne de `/compact` ; bilan des relances (M2) |
| Un hook ou un setup change sans accord | règle « créer à la demande » violée | classe B, liste « jamais », `check.py` en fin de lot (M6) |
| Le régisseur n'est pas relancé après une mise à jour d'`agence` | ancien évaluateur actif | le suivi affiche déjà `agence` manquant ou trop vieux (état du régisseur) ; build id de l'agence change avec le fichier |
| `usage.py` lent sur beaucoup de transcripts | tour de régisseur ralenti | hors des trois minimaux ; lancé à part, pas dans le tour (lot 0 mesure la durée) |
| Deux projets orchestrés posent chacun `/audit-config` | doublon de carte | accepté au départ (Q7) |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple rejetée |
|---|---|---|
| Un mode à blanc | régler les seuils sur des données avant d'envoyer | envoyer dès le lot 3 : un seuil faux coûte des jetons et du contexte |
| Table en fichier de données | « déclarer une fois » ; bilan et évaluateur lisent la même ligne | constantes en dur dans `agence.py` : le bilan les dupliquerait |
| Champ `contextTokens` côté Cate | la taille du contexte n'est ni dans `cate agent usage` ni dans une barre de statut branchée | lire `~/.claude/projects/` depuis `agence` : dépend du nommage d'un dossier de Claude, hors du moteur d'usage |
| Carte par une question à action | précédent `merge:` ; aucun nouveau genre de besoin | un nouveau type de besoin : plus de code d'état et de vue pour le même geste |
| Journal par projet | un écrivain, même dossier que l'état | un journal global dans `~/.cate` : fichier utilisateur global, interdit |

## Tranché par Heifara

Rien n'est tranché au-delà du texte de l'issue #103 et de sa décision « spec d'abord, PR de la spec, l'issue reste ouverte ». Les questions en attente sont dans spec.md (« Questions ouvertes », Q1 à Q9) ; deux sont posées dans le panneau agence (q469, q471).
