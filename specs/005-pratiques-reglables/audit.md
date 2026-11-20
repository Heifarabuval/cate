# Audit : ce qui est propre à Heifara ou à Adfinitas dans le fork

**Base lue** : `origin/main` du fork, `455a23b2` (2026-11-20). Méthode : `grep -rniE` sur `skills/orchestrateur/`, `tools/agence/`, `src/panels/agence/`, `src/shells/desktop/ui/panels/agence/`, `scripts/`, `.specify/`, puis lecture des fonctions trouvées. Mots cherchés : `heifara`, `adfinitas`, `hermes`, `slack`, `xoxb`, `U02FQHK9FPD`, `/Users/`, `.hermes`, `~/.claude`, `/learn`, `/audit-config`, `ways-of-working`, `bus pub`, `taches`, `ponytail`, `karpathy`. Puis les règles de flux : `merge`, `rebase`, `force`, `main`, `done-when`, `pr-merged`, `MAX_AGENTS`.

Résultats nuls, vérifiés : **« Adfinitas » : 0 occurrence** ; `U02FQHK9FPD` : 0 ; `/Users/` : 0 ; `ways-of-working`, `bus pub`, `taches`, `karpathy` : 0 dans ces dossiers (hors tests et fixtures). `ponytail` : 7 commentaires, relevés en section E.

Colonne **Lot** : le lot de `tasks.md` qui traite la ligne. `-` : la ligne reste, la raison est dans « Doit devenir ». Les occurrences hors du dossier `specs/005-pratiques-reglables/` ne sont pas modifiées par ce travail de spécification ; les lots les modifieront.

## A. Noms et adresses personnels

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/agence.py:88-90`, `src/panels/agence/contract/suivi.ts:8-9` | `OWNER_HUMAIN = 'heifara'` : valeur stockée de `owner`, clé opaque, jamais affichée (la CLI affiche `humain`, le panneau `nom()`) | Reste. Décision q303 (spec 002, FR-004) : aucune migration. | - |
| `src/panels/agence/contract/fixtures/sections.json:41,45,293`, `fixtures/etat.json:109,111,133,155,177,291,311,333,355,377` | Données d'essai : « À faire par Heifara », `owner: "heifara"` | Reste. Fixtures exclues du critère SC-002 de la spec 002. | - |
| `fixtures/etat.json:5,949,1004,1027,1050`, `fixtures/sections.json:293`, `scripts/agence-theme/harness.tsx:33` | `Heifarabuval/cate`, `Heifarabuval/autre#13` : dépôt d'exemple | Reste (fixtures et harnais de capture). | - |
| `scripts/cate-fork-install.sh:4,122`, `scripts/cate-fork-install.md:10,75,99,111`, `scripts/cate-fork-update.sh:17,384`, `.specify/memory/constitution.md:3` | URL `Heifarabuval/cate` : l'adresse du fork | Reste (adresse du fork, exclue de SC-002 de la spec 002). Surchargeable déjà par `CATE_FORK_REPO` et `CATE_FORK_RAW_URL`. | - |

## B. Hermes et Slack

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/agence.py:667-677` (`slack_token`, `HERMES_ENV`, `~/.hermes/.env`, `SLACK_USER_TOKEN`) | Le jeton Slack vient d'un fichier de Hermes, la passerelle perso de Heifara | **Réglage** `envoi.slack.variable` (nom de variable d'environnement, défaut `SLACK_USER_TOKEN`) et `envoi.slack.fichier` (fichier de type `.env`, défaut `null`). `HERMES_ENV` et `~/.hermes/.env` supprimés. Le jeton n'est jamais dans la politique : elle ne porte qu'un pointeur. | 2 |
| `tools/agence/test_agence.py:71-72,82-84,2112,2127,2144` | Les tests posent `HERMES_ENV` | Réécrits sur les deux réglages. | 2 |
| `tools/agence/agence.py:700` (docstring de `send_slack`), `skills/orchestrateur/SKILL.md:36` (« token utilisateur de Hermes ») | Texte qui nomme Hermes | « jeton Slack de l'utilisateur (réglage `envoi.slack`) ». | 2 (docstring), 4 (skill) |
| `tools/agence/agence.py:59,606,699-713,877,1255`, `src/shells/desktop/ui/panels/agence/DraftReader.tsx:8,53` | Cible `slack:<canal>`, envoi par `chat.postMessage`, libellés | Reste : tout dev peut avoir Slack. Sans jeton, le brouillon reste à valider (comportement existant). | - |
| `tools/agence/agence.py:2420,2502,2831`, `RegisseurBanner.tsx:34` | Garde d'envoi des outils MCP Slack et Gmail | Reste : c'est un invariant de sécurité, hors politique. | - |
| `tools/agence/agence.py:1929` | `doctor` : « Slack, Gmail » en `info` | Reste. | - |

## C. Règles de PR et de merge codées en dur

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/agence.py:738-739` (`MERGE_OPTIONS` : « Merger (rebase) », `gh pr merge --rebase`) | Méthode de merge fixe, libellé compris | **Réglage** `livraison.methode` (`squash`, `rebase`, `merge`) ; le libellé et le détail sont construits depuis lui. | 2 |
| `tools/agence/agence.py:1025` (`gh pr merge ... --rebase`) | Le merge au clic passe `--rebase` | Passe `--<méthode>` de la politique. | 2 |
| `tools/agence/agence.py:842-846` (`cmd_ask --merge`) | Une question de merge se pose toujours | Refus (code 2) quand `livraison.merge` vaut `dehors` ou `livraison.mode` vaut `main`, message qui cite la clé. | 2 |
| `src/shells/desktop/ui/panels/agence/QuestionCard.tsx:41,68`, `src/panels/agence/contract/types.ts:36,116` | Libellé « Merger quand même (rebase) » | Le libellé lit la méthode publiée dans l'état (`pratiques.livraison.methode`). | 5 |
| `tools/agence/agence.py:1003-1009`, `skills/orchestrateur/SKILL.md:41` | « Demander le rebase » sur conflit, puis `--force-with-lease` sur la branche de PR | Reste : rebaser une branche en conflit est un geste technique, pas une pratique. Le `--force-with-lease` reste l'unique exception au « jamais de force-push ». | - |
| `skills/orchestrateur/SKILL.md:43,65` (« Jamais de merge, push sur `main`, force-push, suppression de branche ») | Interdits des agents | Reste, **invariant** hors politique (aucun agent ne merge ni ne pousse, quel que soit le mode). Le texte du brief est généré par `agence pratiques brief` (lot 1) et le skill l'appelle. | 4 |
| `skills/orchestrateur/SKILL.md:39-40` | Procédure `agence ask --merge`, « Merger grisé » | Le skill lit `livraison.merge` : `clic` garde la procédure, `dehors` pose une question sans `--merge`. | 4 |
| `skills/orchestrateur/SKILL.md:25` (`--new-worktree` pour tout agent qui modifie du code), `:30` (suppression du worktree après PR mergée) | Un worktree et une branche par agent | Conditionné par `livraison.mode` : `pr` garde tout ; `main` n'utilise ni worktree ni branche. | 4 |
| `tools/agence/agence.py:1709-1740` (`worktree_ok`, `pr_mergee`) | La suppression d'un worktree exige une PR mergée sur son dernier commit | Reste : sans objet en mode `main`, il n'y a pas de worktree de besoin. | - |
| `tools/agence/agence.py:716-729,837-840,1381` | `gh issue create`, `gh pr create`, `gh pr view` : GitHub seule forge | Reste, hors périmètre (autre forge non demandée). Signalé dans la spec. | - |
| `tools/agence/agence.py:1919` (`point('gh', ..., True)`) | `doctor --prerequis` : `gh` toujours bloquant | Bloquant seulement quand la politique a besoin de GitHub : `livraison.mode` `pr`, `issue` `obligatoire`, ou une preuve `pr-mergee` ou `ci-verte`. Sinon `info`. | 2 |
| `tools/agence/agence.py:480`, `scripts/agent-cli-matrix.json` | Orchestrateur lancé avec `--agent claude-code` | Reste, hors périmètre. | - |
| `tools/agence/agence.py:1921` | `claude` bloquant | Reste (l'orchestrateur est Claude Code). | - |

## D. Preuve de fin

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/agence.py:229,2770` (`--done-when`) | Texte libre, jamais validé : `--done-when "nimporte quoi"` est accepté et ne fait rien | Grammaire fermée, validée à `need add` (refus code 2 avec la liste des formes valides). Valeur par défaut tirée de la politique quand l'option manque. | 3 |
| `tools/agence/agence.py:1375,1536` (`^(pr-merged\|issue-closed):(\d+)$`) | Seules deux conditions sont évaluées | Grammaire étendue : `ci-green:N`, `tests-local`, `report`, combinables par virgule ; évaluation dans `pratiques.py`. | 3 |
| `skills/orchestrateur/SKILL.md:19` (« Condition de fin : `pr-merged:N`, `issue-closed:N`, `report` ») | `report` est documenté mais évalué nulle part (le besoin ne se ferme que par `need done --evidence`) | Texte généré depuis la politique ; `report` devient une condition réelle. | 4 |
| `tools/agence/agence.py:1541-1554` (PR fermée sans merge : abandon ; PR mergée : fait) | Fermeture automatique sur l'état de la PR | Reste pour un besoin `pr` ; un besoin `task` suit la liste de sa politique. | 3 |
| `tools/agence/agence.py:759-773` (`statusCheckRollup`) | Les checks d'une PR sont déjà lus pour griser Merger | Réutilisés pour `ci-green:N` (aucun nouvel appel `gh`). | 3 |
| `tools/agence/agence.py:280-286` (`close_need` exige `--evidence`) | Pas de « fait » sans preuve | Reste : c'est un invariant. | - |

## E. Pratiques de travail écrites dans le skill

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/agence.py:53,167,456-457,2752`, `skills/orchestrateur/SKILL.md:20` (4 agents vivants au plus) | Plafond tiré du Mac 24 Go de Heifara (mémoire du projet) | **Réglage** `agents.max` (défaut 4, entier de 1 à 16). `--max-agents N` devient une écriture de `agents.max` dans le fichier du projet ; la clé `maxAgents` de l'état n'est plus lue (sans migration, une clé inconnue est ignorée). | 2 |
| `skills/orchestrateur/SKILL.md:20,27` (« un vérificateur différent par implémenteur ») | Pratique de vérification croisée | **Réglage** `verification` (`libre`, `differente`). Reste en dur : « jamais deux implémenteurs sur le même fichier » (intégrité des données). | 4 |
| `skills/orchestrateur/SKILL.md:65` (gabarit de brief : interdits, rapport) | Bloc fixe copié dans chaque brief | Généré : `agence pratiques brief` imprime invariants, TDD, issue, spec-kit, preuve. | 1 (commande), 4 (skill) |
| `skills/orchestrateur/SKILL.md:69,82` (rapport de 15 lignes, réponse de 8 lignes) | Gabarits de rédaction | Reste : convention de confort, pas un flux. Hors politique. | - |
| `skills/orchestrateur/SKILL.md:74` (« un agent Sonnet navigue ») | Nom de modèle | « un agent au modèle le moins cher ». | 4 |
| `skills/orchestrateur/SKILL.md:72-74` (API ou CLI, puis `curl`, puis `cate browser`) | Ordre des outils | Reste : règle de sobriété générique. | - |
| `skills/orchestrateur/SKILL.md:78`, `tools/agence/agence.py` (`observe`) | Journal d'observation (spec 003) | Hors périmètre. | - |
| `skills/orchestrateur/SKILL.md:8-82`, `tools/agence/agence.py` (messages), `src/shells/desktop/ui/panels/agence/*.tsx` (libellés) | Français imposé dans tous les textes | Reste, hors périmètre (question ouverte Q4). Aucun texte nouveau de la spec 005 n'invente un second mécanisme de langue. | - |
| `.specify/memory/constitution.md:37-47,64-83` (TDD d'abord, spec-kit au-delà d'une journée, branche dédiée, pas d'attribution, français) | Gouvernance du dépôt du fork | Reste : ce sont les règles du dépôt `Heifarabuval/cate`, pas celles du produit. C'est la **source du contenu** du preset `pr-tdd`. | - |
| `tools/agence/agence.py:88,318,1988,2055,2140,2163,2196` | Commentaires `# ponytail:` : marqueur de dette d'un outil du setup de Heifara | Reste : des commentaires sans effet, aucun comportement n'en dépend. | - |
| `.specify/workflows/speckit/workflow.yml`, `.specify/templates/` | Spec-kit livré dans le dépôt | Reste. Le réglage `speckit` ne fait que dire au skill s'il propose la séquence ; il ne lance rien. | 4 |

## F. Déclencheurs et skills personnels (spec 004)

| Occurrence | Ce que c'est | Doit devenir | Lot |
|---|---|---|---|
| `tools/agence/declencheurs.json:17-28` (T2 `/learn`, `actif: true`) | Skill du setup de Heifara ; un autre dev reçoit une carte qui propose une commande absente chez lui | **Réglage** `declencheurs.actifs` (liste d'identifiants). `actif` disparaît de la table (coupe nette). Défaut : `["T1"]`. | 4 |
| `tools/agence/declencheurs.json:31-42` (T3 `/audit-config`, `actif: true`), `:35` (`~/.claude/state/setup/ledger.jsonl`) | Idem, et chemin du registre de son setup | Idem. La lecture du registre reste en lecture seule et facultative. | 4 |
| `tools/agence/declencheurs.json:59,73,87,101,115,129` (`tooling-scout`, `skill-creator`, `/fewer-permission-prompts`, `claude-md-improver`, `graphify`, `/update-config`, tous `actif: false`) | Commandes de son setup | Restent dans la table ; actives seulement si listées dans `declencheurs.actifs`. | 4 |
| `tools/agence/agence.py:2044` (`SETUP_JAMAIS_EN_A`) | Commandes que le cercle n'envoie jamais seul | Reste : garde-fou de la spec 004 (FR-006). | - |

## Bilan

- **Réglages créés** (12) : `livraison.mode`, `livraison.merge`, `livraison.methode`, `issue`, `tests`, `speckit`, `verification`, `preuve`, `agents.max`, `declencheurs.actifs`, plus `envoi.slack.variable` et `envoi.slack.fichier`.
- **Supprimés** : `HERMES_ENV` et `~/.hermes/.env`, `MAX_AGENTS` en dur, la clé `maxAgents` de l'état, le champ `actif` de `declencheurs.json`.
- **Restent, par décision écrite** : la clé opaque `heifara`, les fixtures, l'adresse du fork, les gardes d'envoi, GitHub comme forge, Claude Code comme agent, le français, la gouvernance du dépôt.
- **Aucune occurrence « Adfinitas »** : la contrainte ne vient pas d'un nom d'agence mais de pratiques (Hermes, plafond de RAM, skills du setup).
