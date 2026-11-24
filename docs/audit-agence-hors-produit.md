# Audit de l'agence hors produit : mail one-shot, LP one-shot, automatisation et backend client

Besoin n940, fiche F64 (P2, audit). Rapport seul, aucun code (décision D6).

## Périmètre et méthode

- Sources lues sur `origin/main` `b4c985e6` (le worktree `n940-auditeur` part de `4ccb5120`, qui n'a ni `tools/agence/`, ni `skills/metier/`, ni `specs/012`). Tous les chemins:lignes ci-dessous sont ceux de `origin/main`.
- Lus : `tools/agence/metiers.json`, `connecteurs.json`, `pratiques.json`, `pratiques.py`, `backlog.py`, `agence.py` (extraits), `skills/metier/SKILL.md`, `skills/orchestrateur/SKILL.md` (extraits), `specs/012-connecteurs-metiers/spec.md`, `agence fiche show F64`, `agence pratiques show` (politique « neutre », métier `dev`, tout par défaut).
- Rien exécuté qui écrive (pas de `fiche add`, pas de `pratiques set`). Les comportements décrits viennent de la lecture du code, pas d'une exécution.

## Constats transverses (valent pour les 3 cas)

1. **Aucun métier hors `dev` n'est livré.** `tools/agence/metiers.json:2-3` ne contient que `dev`, avec `connecteurs`, `validateur` et `recettes` vides. `tools/agence/connecteurs.json:1` vaut `[]`. Le catalogue est donc vide : la couche 3 existe en mécanisme (spec 012), pas en contenu.
2. **Ajouter un métier ou un connecteur passe par une PR de code.** `skills/metier/SKILL.md:30` (« Un nouvel outil entre au catalogue par une PR, jamais par un fichier du projet ») et `:41` (« propose la PR qui l'ajoute au catalogue »). `specs/012-connecteurs-metiers/spec.md:25` et `:202` (Q1, connecteur propre à un projet : hors v1). Pour un travail one-shot, c'est disproportionné.
3. **Un seul métier par workspace.** `tools/agence/pratiques.json:3-5` : clé `metier`, `"un": true`, portée `workspace`. Toutes les fiches du projet partagent le même métier, les mêmes preuves par défaut et la même politique de livraison. `spec.md:206` (Q5) : pas de surcharge du validateur par projet. Une agence qui mélange dev, mail et LP dans un même dépôt ne peut pas typer les fiches.
4. **Une fiche ne passe « prête » qu'avec 6 champs, dont `fichiers` et `vision`.** `tools/agence/backlog.py:23` (`EXIGES = titre, type, preuve, priorite, fichiers, vision`), contrôle en `:161-163`. La vision se choisit dans un référentiel produit : `backlog.py:25` (`couche-1..4`, `FR-001..FR-014` de la spec 009). Une valeur hors référentiel n'est pas refusée (`backlog.py:24`, la revue la signale), mais un champ vide l'est. `backlog.py:20` (`TYPES = bug, idee, retour, audit, tache`) : aucun type « livrable ».
5. **La preuve de fin est une grammaire fermée, orientée PR.** `tools/agence/pratiques.py:420` : `pr-merged:N, issue-closed:N, ci-green:N, tests-local, report, draft-sent:ID, preuve:NOM`. Sans métier, le défaut est `pr-mergee` (mode `pr`) ou `rapport` (mode `main`) : `pratiques.py:454-460`. La clé `preuve` n'offre que 4 valeurs : `tools/agence/pratiques.json:38`. Un `pr-merged` sans numéro bloque : `pratiques.py:480-481` (« PR non rattachée »). La fiche lancée copie sa `preuve` telle quelle en `done_when` : `tools/agence/agence.py:1848`.
6. **Les contrôles machine ne regardent que GitHub.** `agence.py:1600-1603` (`pr_du_besoin`), `:1923-1925` (`preuve_a_l_abandon` : seule une PR mergée ou une issue fermée vaut « fait » à l'abandon). Les preuves humaines (`tests-local`, `report`, `draft-sent`) valent sur simple `--evidence` : `pratiques.py:472-486`. Les preuves de métier (`preuve:NOM`) sont contrôlées par `need done` : `pratiques.py:477-478`, `agence.py:341-361` ; type `fichier` (non vide, dans le workspace), `lien` (https), `clic` : `spec.md:30`, `:151-152`.
7. **Le cycle PR et issue est dans la politique, pas dans le type de travail.** `livraison.mode` (`pr` ou `main`, `pratiques.json:10-13`), `livraison.merge`, `issue` (`libre` ou `obligatoire`, `:20-23`). En mode `pr`, l'orchestrateur crée un worktree par agent qui modifie du code : `skills/orchestrateur/SKILL.md:27`. Les invariants (jamais de merge ni de push par un agent, preuve obligatoire) valent partout : `pratiques.json:83-88`, repris dans chaque brief par `pratiques.py:405-417`.

## Cas 1 : mail one-shot

Exemple : un mail client rédigé une fois, validé puis envoyé, sans dépôt de code.

### 1. Ce qui est déjà couvert

- **Envoi par carte validée.** Un agent ne fait que préparer un brouillon `agence draft new --cible <cible>` ; le régisseur envoie au clic de l'humain : `skills/orchestrateur/SKILL.md:39-41`, invariant `pratiques.json:84`. La spec 012 note que la messagerie « a déjà sa carte d'envoi » : `spec.md` (tableau « Connecteurs à vérifier », ligne chef de projet).
- **Preuve d'envoi native.** `draft-sent:ID` existe dans la grammaire (`pratiques.py:420`) et un brouillon crée un besoin qui ferme sur l'envoi : `agence.py:1020` (`done_when=f'draft-sent:{did}'`), `:1051-1052`.
- **Preuves non PR.** `report` (« Compte rendu », `pratiques.json:38`) et, avec un métier, `clic` (accord du client) : `spec.md` US4 (accord-client, clic).
- **Écriture par MCP sous garde.** Si une messagerie est au catalogue, l'écriture est une carte à un appel : `SKILL.md:44-52` (metier), `spec.md:27`.

### 2. Ce qui bloque

- **Fiche prête.** `fichiers` est exigé (`backlog.py:23`) alors qu'un mail ne touche aucun fichier du dépôt ; `vision` aussi, avec un référentiel de couches produit (`backlog.py:25`). Contournement possible : y mettre n'importe quoi, ce qui vide le sens du champ.
- **Preuve de la fiche.** `draft-sent:ID` suppose un brouillon qui n'existe pas encore quand la fiche est écrite (l'ID n'est connu qu'après `agence draft new`). Défaut sans métier : `pr-mergee` (`pratiques.py:454-460`), faux pour un mail. Reste `report` (preuve déclarée à la main).
- **Pas de métier « rédaction ».** Le catalogue est vide (`metiers.json:2-3`, `connecteurs.json:1`) : pas de connecteur Gmail ni Slack déclaré, donc pas de carte `outil:<connecteur>:<outil>`. Les boutons d'envoi existent pour Slack et mail via `agence draft`, pas via un connecteur MCP (`SKILL.md:44` metier : écriture MCP seulement si l'outil est au catalogue).
- **Livraison.** `livraison.mode` vaut `pr` ou `main` (`pratiques.json:10-13`) : aucun mode « sans dépôt ». Un mail n'a ni PR ni merge ; la clé est inapplicable et la politique du projet garde `pr` pour les autres fiches.
- **Cycle issue.** `issue: obligatoire` (preset `pr-tdd`, `pratiques.json:102-105`) imposerait un ticket GitHub par mail.

### 3. Jeu de pratiques proposé (mail one-shot)

| Réglage | Valeur proposée | Pourquoi |
|---|---|---|
| métier | `redaction` (à créer au catalogue) | validateur propre, sans PR |
| connecteurs.lecture | boîte mail, annuaire contacts (à vérifier) | contexte du mail |
| connecteurs.ecriture | messagerie, par carte | `SKILL.md:44-52` |
| validateur | `brouillon-valide` (clic) puis `envoi` (lien ou `draft-sent`) | deux preuves, 0 PR |
| livraison.mode | sans objet (nouveau : `aucune`) | pas de dépôt |
| issue | libre | pas de ticket pour un mail |
| tests | libre | rien à tester |
| verification | `differente` | un second agent relit ton, fautes, destinataires |
| preuve | remplacée par le validateur du métier | `spec.md:30` |
| fiche prête | `fichiers` et `vision` facultatifs pour le type `livrable` | écart `backlog.py:23` |

## Cas 2 : LP one-shot

Exemple : une landing page livrée une fois à un client, en HTML ou dans un dépôt dédié.

### 1. Ce qui est déjà couvert

- **Panneau navigateur du métier.** Un métier déclare ses panneaux (URL navigateur ou panneau perso) et l'orchestrateur les ouvre au lancement : `skills/metier/SKILL.md:18` et `:21-28` (ordre d'accès), `spec.md:154` (FR-010).
- **Preuve par fichier ou lien.** `preuve:NOM` de type `fichier` (capture, non vide, dans le workspace) ou `lien` (URL https) : `spec.md:30`, `:152`, `SKILL.md:54-56`.
- **Cycle PR classique si la LP vit dans un dépôt.** `pr-merged` et `ci-green` fonctionnent tels quels (`pratiques.py:472-495`), avec `agence need pr` pour rattacher la PR (`agence.py:1600`).
- **Le reste de la politique.** `tests`, `verification: differente`, `livraison.merge` s'appliquent sans changement (`pratiques.json:10-37`).

### 2. Ce qui bloque

- **Preuves visuelles absentes de la grammaire dev.** Pour `dev`, aucune preuve « captures aux 3 largeurs » ni « vu sur l'URL de prod » : les formes sont `pr-merged`, `ci-green`, `tests-local`, `report` (`pratiques.py:420`). Seul un métier dédié ajoute `preuve:captures` (`spec.md:30`) ; il n'existe pas (`metiers.json:2-3`).
- **TDD inadapté.** `tests: tdd` (`pratiques.json:24-27`, preset `pr-tdd` `:102-105`) exige un test rouge avant le code ; pour une LP, la vérification utile est visuelle. La clé `tests` n'a que `libre` et `tdd`.
- **Contrainte projet.** Le brief du besoin interdit Playwright, Electron et toute fenêtre ; la capture navigateur doit passer par un panneau navigateur Cate (`cate panel create browser`), non catalogué comme connecteur. Rien ne dit comment un agent produit un fichier de capture dans ce cadre (non vérifié).
- **Fiche prête.** Même blocage que le mail : `vision` produit (`backlog.py:25`), `fichiers` à lister avant d'avoir les fichiers d'une LP à créer (`backlog.py:23`).
- **Livraison chez le client.** La PR mergée ne prouve pas que la page est en ligne ; seule une preuve de type `lien` (URL de prod) le fait, hors grammaire dev. Pas de notion d'environnement cible (preview, prod) dans `pratiques.json`.
- **Figma.** Une maquette source est un connecteur de lecture naturel, mais aucun connecteur Figma n'est au catalogue (`connecteurs.json:1`).

### 3. Jeu de pratiques proposé (LP one-shot)

| Réglage | Valeur proposée | Pourquoi |
|---|---|---|
| métier | `integration-web` (à créer) | validateur visuel |
| connecteurs.lecture | Figma (lecture), site en navigateur | source et rendu |
| connecteurs.ecriture | aucun | publication = action humaine |
| panneaux | page de preview en navigateur | `spec.md:154` |
| validateur | `captures` (fichier, 3 largeurs), `page-en-ligne` (lien), `accord-client` (clic) | `spec.md:30` |
| livraison.mode | `pr` si dépôt dédié, `main` sinon | `pratiques.json:10-13` |
| tests | libre (vérification au navigateur) | TDD inadapté |
| issue | libre | tâche unique |
| verification | `differente` (second agent compare captures et maquette) | |
| ci-green | oui si le dépôt a une CI | `pratiques.py:488-491` |

## Cas 3 : automatisation ou backend client

Exemple : un workflow n8n ou une API pour un client, avec accès à des systèmes tiers et une mise en production.

### 1. Ce qui est déjà couvert

- **Le code du backend, s'il est dans le dépôt du projet.** Cycle PR, issue obligatoire, TDD, `ci-green`, `pr-merged` : tout le dispositif dev s'applique (`pratiques.json:92-105` presets, `pratiques.py:472-495`).
- **Écriture externe sous garde.** Toute écriture dans un outil MCP déclaré passe par une carte à un appel, avec échec fermé pour un outil non déclaré : `spec.md:27`, `:56-60` (US1), `SKILL.md:44-52`. L'API et le navigateur sont en lecture seule, l'écriture devient une action humaine : `spec.md:28`, `:203` (Q2).
- **Secrets.** Un connecteur nomme sa variable, jamais sa valeur ; `agence connecteur check` ne lit que la présence : `SKILL.md:58-62`, `spec.md:29`, `:148-150` (FR-006).
- **Invariants anti-merge et anti-push** (`pratiques.json:83-88`).

### 2. Ce qui bloque

- **Le livrable n'est pas toujours un dépôt.** Un workflow n8n vit dans n8n, pas dans git : `pr-merged` n'a pas d'objet. Restent `report` ou `tests-local` (déclaratifs, `pratiques.py:481-482`) ou une preuve de métier.
- **Pas de connecteur n8n ni de client.** Rien au catalogue (`connecteurs.json:1`). Les outils d'écriture (publication d'un workflow, déploiement) doivent être listés un par un dans `ecriture` pour passer par une carte ; un outil non listé est traité comme écriture (`spec.md:60`), un serveur non déclaré n'est pas gardé du tout (`spec.md:61`, scénario 6). Donc un MCP n8n non déclaré contourne la garde.
- **Aucune notion de prod.** Pas de clé « environnement cible », « dev avant prod », « rollback prêt », « pire cas chiffré » dans `pratiques.json` (clés lues : `metier`, `connecteurs.*`, `livraison.*`, `issue`, `tests`, `speckit`, `verification`, `preuve`, `agents.*`, `envoi.*`). La règle existe dans les consignes de l'humain, pas dans la politique de l'agence.
- **Un client, un dépôt, un projet.** `root()` donne un seul dépôt (`agence.py:148`) ; le backlog et l'état sont par dépôt. Le mélange « dépôt du client » et « workflows n8n d'Adfinitas » n'est pas traité. `pratiques.py:477-478` montre un champ `repo` dans la lecture GitHub : support multi-dépôt de la PR possible, non vérifié.
- **Fiche prête.** `fichiers` est mal défini pour un workflow n8n ; `vision` produit (`backlog.py:23-25`).
- **spec-kit.** `speckit: au-dela-d-une-journee` (`pratiques.json:28-32`) suppose du code dans le dépôt.
- **Preuve de bon fonctionnement.** Aucune forme « exécution test réussie » ni « webhook répond » dans la grammaire (`pratiques.py:420`) ; seul `tests-local` déclaratif s'en approche.

### 3. Jeu de pratiques proposé (automatisation et backend client)

| Réglage | Valeur proposée | Pourquoi |
|---|---|---|
| métier | `automatisation` (à créer) | validateur propre |
| connecteurs.lecture | n8n (lecture workflows et exécutions), dépôt client | diagnostic |
| connecteurs.ecriture | n8n `publish`, `update`, `execute` : par carte, un appel chacun | `SKILL.md:44-52` |
| validateur | `test-dev` (fichier : sortie d'exécution en dev), `accord-prod` (clic) | preuve avant prod |
| livraison.mode | `pr` pour le code ; workflows exportés en JSON versionnés | trace et relecture |
| livraison.merge | `clic` | |
| issue | obligatoire | traçabilité client |
| tests | `tdd` pour le code, libre pour un workflow | |
| verification | `differente` | |
| nouveau (hors schéma actuel) | `environnement: dev` par défaut, prod seulement par carte, « pire cas » et rollback dans la carte | manque `pratiques.json` |

## Non vérifié

- Le contenu réel de la question q910 (non lue) et de `agence need list` : seule la fiche F64 a servi de contexte.
- Aucune commande qui écrit l'état (`agence fiche add`, `need add`, `pratiques set`) n'a été lancée : le refus ou l'acceptation d'une fiche à `fichiers` ou `vision` vides est lu dans `backlog.py:161-163` et `:248-249`, pas observé.
- Validation de la `preuve` d'une fiche contre la grammaire à la création : non lue ; `agence.py:1848` ne la passe qu'à `add_need`. Si `draft-sent:ID` est refusé ou non à ce stade, non établi.
- `skills/orchestrateur/SKILL.md` : lu par extraits (lignes 19-49 et 73), pas en entier. Le comportement d'un agent sur un besoin sans dépôt n'est pas établi.
- Support multi-dépôt de `gh_states` et de `pr_du_besoin` : indices seulement (`pratiques.py:477`).
- Existence réelle de MCP pour n8n, Figma, Gmail et leur droit en lecture ou écriture séparés : `spec.md` (« non vérifié »). Une session expose des outils n8n, Figma, Gmail et Slack ; leur découpage lecture et écriture n'a pas été relevé.
- Version de `origin/main` à jour : lu à `b4c985e6` ; des PR peuvent avoir changé `agence.py`, `backlog.py` ou `pratiques.py` depuis (un autre agent travaille sur `agence.py`).
- « Autre organisation » : couvert seulement par les constats 3 et 4 (un métier par workspace, référentiel de vision produit). Pas d'audit de `agence nom` (un humain validateur unique), de `declencheurs` ni des presets pour une équipe non dev.
