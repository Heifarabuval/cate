# Feature Specification: Réglages par workspace, pour tous, dans l'interface

**Feature Branch**: `docs/spec-reglages-workspace`

**Created**: 2026-11-20 (besoin n547, base `origin/main` `38789c7a`)

**Status**: Draft. Spec d'abord, aucune ligne de code produit. Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: demande de Heifara : le plafond d'agents ne doit pas rester une option de ligne de commande ou une valeur en dur ; il doit être accessible et réglable **dans l'interface, par workspace**. Même chose pour **tous** les paramètres de l'agence, pour que n'importe qui s'approprie le projet simplement, **même sans être technique** (visée : chef de projet, marketing, SEO, pas seulement un dev).

Liens :
- [`inventaire.md`](inventaire.md) : tout ce qui se règle ou est codé en dur, sourcé chemin:ligne, avec sa décision.
- Spec `005-pratiques-reglables` : le schéma déclaré une fois (`tools/agence/pratiques.json`), les deux fichiers hors dépôt, la commande `agence pratiques`, le panneau en lecture seule (005-L5). Cette spec les prolonge, ne les refait pas.
- Spec `004-cercle-vertueux` : la table `declencheurs.json`.
- Constitution du fork : II (déclarer une fois), III (coupes nettes), V (le runtime est l'application), VI (tests d'abord), VII (le plus simple), IX (écart minimal avec upstream).

## Clarifications

### Session 2026-11-20

- Q: Où vivent les réglages ? → A: dans les fichiers de la spec 005 (projet `<racine>/.cate/tmp/agence/pratiques.json`, dev `~/.config/agence/pratiques.json`), schéma dans `tools/agence/pratiques.json`. Le formulaire est dans le **panneau agence** ; il lit le schéma que la CLI publie et écrit par le régisseur, comme tout autre clic du panneau. Pas de `defineSettings` : comparaison et coût dans `plan.md` (« Décision : où vivent les réglages »). Les réglages natifs de Cate (`cli*Enabled`) restent natifs.
- Q: « Par workspace » veut dire quel fichier ? → A: le fichier du projet. Un workspace orchestré a un panneau agence par racine de dépôt (`docs/architecture.md`, « The agence panel ») ; ses réglages sont ceux de cette racine, partagés par ses worktrees. Le fichier du dev reste la couche « tous mes projets ».
- Q: Les options de ligne de commande ? → A: un contournement ponctuel, jamais la source (demande de Heifara). `agence start` lit le réglage du workspace ; `--max-agents N` et `--no-notify` posent une valeur **ponctuelle**, visible dans le formulaire avec son origine, effacée au prochain `agence start`.
- Q: Qui peut changer un réglage ? → A: l'humain, par le formulaire ou par `agence pratiques`. Les agents restent refusés (garde `pages` de 005-L1, jeton du régisseur que seule la session connaît). Les invariants restent hors schéma.
- Q: Quel périmètre pour « tous les paramètres » ? → A: tout ce qu'une personne choisit selon sa façon de travailler : les 12 réglages de 005, plus 4 nouveaux (notifications, rappel, modèle et effort par défaut). Les constantes de plateforme (délais de `gh`, lecture d'écran, rétention de la spec 003) restent des constantes, chacune avec sa raison (`inventaire.md`, section 3).

## Vocabulaire

- **Réglage** : une clé du schéma (spec 005), désormais avec un nom, une phrase et des choix nommés.
- **Origine** : d'où vient la valeur effective : « par défaut » (preset `neutre`), « vos réglages » (fichier du dev), « ce workspace » (fichier du projet), « ponctuel » (option de `agence start`).
- **Formulaire** : la vue des réglages du panneau agence, générée depuis le schéma publié.
- **Premières questions** : les 3 à 5 réglages essentiels posés à la première ouverture d'un workspace orchestré.
- **Couche ponctuelle** : les valeurs posées par une option de `agence start`, rangées dans `state.json`, effacées au prochain `agence start`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Régler son workspace sans terminal (Priority: P1)

Camille, cheffe de projet, ouvre le panneau agence d'un workspace orchestré et clique « Réglages ». Elle voit une liste de réglages en français simple, groupés en « Essentiel » et « Avancé ». « Agents en même temps : 4 (par défaut) ». Elle le passe à 2. La ligne dit maintenant « 2 (ce workspace) » et un bouton « Revenir au défaut (4) » apparaît. Elle ne voit jamais de JSON ni de nom de clé.

**Why this priority**: c'est la demande. Sans formulaire, le réglage reste une affaire de dev.

**Independent Test**: test Vitest de la vue sur un instantané qui porte les champs publiés ; test de session : l'op `pratique.set` part en POST au régisseur ; test Python : le POST `/pratiques/set` écrit le fichier du projet et le tour suivant publie la nouvelle valeur avec l'origine `projet`.

**Acceptance Scenarios**:

1. **Given** un état qui porte `pratiques.champs`, **When** le formulaire s'ouvre, **Then** chaque réglage montre son nom, sa phrase, sa valeur, son défaut et son origine ; aucune clé technique (`agents.max`) ni JSON n'apparaît.
2. **Given** le réglage « Agents en même temps », **When** Camille choisit 2, **Then** le fichier du projet porte `agents.max: 2`, le formulaire dit « 2 (ce workspace) », et `agence pratiques show` dans un terminal rend la même valeur et la même source.
3. **Given** une valeur posée dans ce workspace, **When** Camille clique « Revenir au défaut », **Then** la clé est retirée du fichier du projet et la valeur effective redevient celle du dev ou du preset, origine affichée.
4. **Given** le choix « Directement sur la branche principale » alors que la preuve vaut « Demande fusionnée », **When** Camille valide, **Then** rien n'est écrit et une phrase humaine s'affiche sous le réglage : « Une tâche ne peut pas finir par une demande fusionnée si le travail ne passe pas par une demande. Changez d'abord "Quand une tâche est finie". »
5. **Given** le régisseur arrêté, **When** Camille change un réglage, **Then** le formulaire dit « Réglages indisponibles : l'agence ne tourne pas » avec le bouton « Relancer » existant ; rien n'est écrit.

---

### User Story 2 - Partir d'un modèle d'un clic (Priority: P1)

Max ouvre le formulaire et voit deux modèles : « Simple » (preset `neutre`) et « Rigoureux : PR et tests d'abord » (preset `pr-tdd`), chacun avec une phrase. Il clique « Rigoureux ». Comme il a déjà changé deux réglages dans ce workspace, Cate lui demande : « Ce modèle remplace vos 2 réglages de ce workspace. Continuer ? ». Il confirme ; les 16 valeurs suivent le modèle, origine « ce workspace (modèle Rigoureux) ».

**Why this priority**: un modèle est la façon la plus courte de s'approprier l'outil ; c'est aussi le flux de Heifara (`pr-tdd`).

**Independent Test**: test Python de `agence pratiques preset pr-tdd --remplacer` (le fichier ne garde que `preset`) ; test Vitest de la confirmation (par `ClientUi`) quand des réglages du workspace existent, et de son absence sinon.

**Acceptance Scenarios**:

1. **Given** aucun réglage dans ce workspace, **When** clic sur un modèle, **Then** pas de confirmation, `preset` est posé, les valeurs suivent.
2. **Given** N réglages dans ce workspace, **When** clic sur un modèle, **Then** la confirmation cite N ; « Annuler » ne change rien ; « Continuer » écrit `{"preset": "<nom>"}` seul.
3. **Given** le modèle actif, **When** le formulaire s'ouvre, **Then** il est marqué « actif » et les réglages qui s'en écartent portent l'origine « ce workspace ».

---

### User Story 3 - Les premières questions (Priority: P2)

Nadia ouvre pour la première fois l'agence sur un dépôt. Avant que l'orchestrateur ne démarre, le panneau pose quatre questions, une par écran, avec des réponses nommées et la réponse par défaut présélectionnée : « Comment voulez-vous recevoir le travail des agents ? », « Les agents écrivent-ils un test avant le code ? », « Un second agent relit-il chaque travail ? », « Combien d'agents au plus en même temps ? ». Elle répond, clique « Terminer », et l'orchestrateur démarre avec ces réglages. « Passer » garde les défauts et ne repose plus les questions.

**Why this priority**: c'était la vision (« l'installation pose une série de questions »). Le formulaire suffit pour tout régler ; les questions rendent les essentiels impossibles à rater.

**Independent Test**: test de session : sans fichier du projet, l'orchestrateur n'est pas lancé tant que les questions ne sont pas finies ou passées ; test Vitest de la vue des questions ; test Python : `projet: false` publié tant que le fichier n'existe pas.

**Acceptance Scenarios**:

1. **Given** un dépôt sans fichier du projet, **When** le panneau agence s'ouvre, **Then** les questions s'affichent et l'orchestrateur n'est pas lancé ; le régisseur tourne.
2. **Given** les questions, **When** Nadia clique « Terminer », **Then** ses réponses sont écrites dans le fichier du projet en une écriture, puis l'orchestrateur est lancé.
3. **Given** les questions, **When** Nadia clique « Passer », **Then** le fichier du projet est créé avec `{"preset": "neutre"}`, l'orchestrateur est lancé, et les questions ne reviennent pas.
4. **Given** un fichier du projet existant (même vide), **When** le panneau s'ouvre, **Then** pas de questions.
5. **Given** les questions affichées sur un poste, **When** un second client du même workspace répond, **Then** les deux voient la fin ; une seule écriture a lieu.

---

### User Story 4 - Les options de ligne de commande restent un contournement (Priority: P2)

Heifara lance `agence start --max-agents 6` pour une vague exceptionnelle. Le formulaire affiche « Agents en même temps : 6 (ponctuel, jusqu'au prochain démarrage) » avec « Revenir au réglage du workspace (4) ». Le lendemain, `agence start` sans option : le plafond redevient 4. Rien n'a changé dans le fichier du projet.

**Why this priority**: l'option reste utile à un dev ; elle ne doit plus être une seconde source invisible.

**Independent Test**: test Python : `start --max-agents 6` pose `st['ponctuel']['agents.max'] = 6` sans toucher au fichier du projet ; `plafond(st)` rend 6 ; `start` sans option vide `ponctuel` ; `show` rend la source `ponctuel`.

**Acceptance Scenarios**:

1. **Given** `agents.max` à 4 dans ce workspace, **When** `agence start --max-agents 6`, **Then** le plafond effectif est 6, la source `ponctuel`, et le fichier du projet est inchangé.
2. **Given** une valeur ponctuelle, **When** `agence start` sans option, **Then** la couche ponctuelle est vide et la valeur du workspace revient.
3. **Given** une valeur ponctuelle, **When** l'humain change ce réglage dans le formulaire, **Then** la valeur ponctuelle de cette clé est retirée et la nouvelle valeur est écrite dans le fichier du projet.
4. **Given** `agence start --no-notify`, **When** un besoin passe « À faire par l'humain », **Then** aucune notification système ; `notifications.systeme` du workspace est inchangé.

### Edge Cases

- Régisseur arrêté : le formulaire se lit (dernier état publié) mais toute écriture est refusée avec la phrase de US1-5 ; jamais d'écriture par la vue ni par la session.
- Fichier du projet invalide (édité à la main) : bannière de 005-L5 en mots simples (« Le fichier de réglages de ce workspace est illisible »), formulaire en lecture seule, bouton « Repartir des réglages par défaut » qui écrit `{"preset": "neutre"}` après confirmation (`ClientUi`). Les questions ne s'affichent pas : le fichier existe.
- Deux clients qui écrivent la même clé : le régisseur sérialise (verrou de `_modifier`, `pratiques.py:178-197`), le dernier clic gagne, les deux voient la valeur publiée au tour suivant.
- Réglage de portée dev (`envoi.slack.*`) : écrit dans le fichier du dev de la machine du runtime ; origine « vos réglages (tous vos projets) ». Un client distant le voit ainsi (Q3).
- CLI ancienne (état sans `champs`) : le formulaire ne s'affiche pas, la ligne de 005-L5 reste ; aucune erreur.
- Workspace non orchestré : aucun panneau agence, donc ni formulaire ni questions. Les réglages natifs restent dans l'écran Réglages.
- Valeur ponctuelle hors bornes du schéma (`--max-agents 40`) : refusée par `agence start` (code 2) avec la phrase du schéma.
- Un agent poste au régisseur : refusé, il n'a pas le jeton (`TOKEN`, `agence.py:65`) ; `agence pratiques set` lui est refusé par la garde `pages` (005-L1).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Chaque clé du schéma `tools/agence/pratiques.json` MUST porter, déclarés une fois à côté de ses valeurs : `nom` (court), `explique` (une phrase sans jargon), `choix` (un libellé par valeur permise, ou des bornes pour un entier), `groupe` (`essentiel` ou `avance`), `portee` (`workspace` ou `dev`), et pour les essentiels `question` (la phrase des premières questions). `dit` disparaît (coupe nette) : `explique` le remplace. Chaque preset MUST porter `nom` et `explique`. Un test refuse une clé sans ces champs.
- **FR-002**: Le schéma MUST gagner 4 clés : `notifications.systeme`, `notifications.rappel`, `agents.modele`, `agents.effort` (valeurs et défauts : `inventaire.md`, « Nouveaux réglages proposés »), dans les deux presets.
- **FR-003**: `watch` MUST publier dans `st['pratiques']`, en plus de ce que publie 005 : `champs` (pour chaque clé, dans l'ordre du schéma : clé, nom, explication, groupe, portée, choix, défaut du preset `neutre`, valeur effective, origine), `presets` (nom, libellé, explication, actif ou non), `projet` (le fichier du projet existe), `nbProjet` (nombre de clés posées dans ce workspace), `invariants` (textes rendus avec `nom()`). Rien de cela n'est recopié dans le code TypeScript : la vue rend ce qu'elle reçoit.
- **FR-004**: Le régisseur MUST accepter `POST /pratiques/set`, `/pratiques/unset` et `/pratiques/preset` (jeton des formulaires, comme `/draft/...`) et les traiter par `pratiques.regler`, `retirer` et `poser_preset` : même validation, même verrou, même écriture que la CLI. Un réglage de portée `dev` s'écrit dans le fichier du dev. `/pratiques/preset` avec `remplacer=1` écrit `{"preset": "<nom>"}` seul. Réponse 400 avec la phrase humaine en cas de refus.
- **FR-005**: Les refus MUST se dire en mots simples : le message cite le `nom` du réglage et les libellés de `choix`, jamais la clé ni le chemin du fichier (la CLI garde son message technique pour `agence pratiques set`, et ajoute la phrase simple). Les deux cohérences de 005 MUST avoir une phrase humaine déclarée dans le schéma.
- **FR-006**: Le panneau agence MUST afficher un formulaire généré depuis `champs` : un réglage par ligne, nom, phrase, contrôle adapté (liste de choix nommés pour `valeurs` et `liste`, cases pour une liste, sélecteur borné pour un entier, champ texte seulement pour un motif), défaut visible, origine en mots (« par défaut », « vos réglages », « ce workspace », « ponctuel »), bouton « Revenir au défaut » quand l'origine n'est pas « par défaut ». Groupe « Avancé » replié par défaut. Les invariants en texte fixe, sans contrôle. Aucune clé technique ni JSON visible.
- **FR-007**: La vue MUST demander une confirmation par `ClientUi` avant un preset qui remplace des réglages du workspace (`nbProjet > 0`) et avant « Repartir des réglages par défaut ». Elle n'écrit aucun fichier ; la session ne fait que relayer au régisseur (constitution V, « Views ask, sessions act »).
- **FR-008**: Le bouton « Ouvrir le fichier » et l'op `openPratiques` de 005-L5 MUST disparaître avec ce qu'ils seuls utilisent (`parts/runtime/pratiquesFile.ts`, la dépendance `openEditor` si plus rien ne l'appelle) : le formulaire les remplace (coupe nette, pas de JSON visible).
- **FR-009**: `agence start --max-agents N` et `--notify/--no-notify` MUST écrire la **couche ponctuelle** `st['ponctuel']` (clés `agents.max`, `notifications.systeme`), jamais le fichier du projet ; `agence start` MUST remplacer la couche ponctuelle par les seules options passées (sans option : vide). `pratiques.charger` MUST prendre la couche ponctuelle en dernier, source `ponctuel`, validée comme le reste. Les clés `notify` et `maxAgents` de l'état ne sont plus lues (coupe nette).
- **FR-010**: Un réglage écrit par le formulaire ou par `agence pratiques set` MUST retirer la valeur ponctuelle de la même clé, pour que la valeur choisie soit celle qui s'applique.
- **FR-011**: `notifications.systeme` MUST remplacer `st['notify']` (`agence.py:1616`) ; `notifications.rappel` MUST remplacer `RAPPEL` (`:367`, `:1619`), 0 voulant dire aucun rappel.
- **FR-012**: `agence need add` sans `--model` (sans `--effort`) MUST stocker `agents.modele` (`agents.effort`) sauf s'il vaut `auto` ; `--model` et `--effort` l'emportent. `need show` dit l'origine (« besoin » ou « workspace »).
- **FR-013**: Quand l'état publie `projet: false`, le panneau MUST afficher les premières questions (les clés `groupe: essentiel` qui portent `question`, dans l'ordre du schéma, 3 à 5) avant tout, et la session MUST attendre leur fin ou « Passer » pour lancer l'orchestrateur. « Terminer » écrit toutes les réponses en un POST (`/pratiques/set` multiple) ; « Passer » écrit `{"preset": "neutre"}`.
- **FR-014**: Le skill `orchestrateur` MUST cesser de recopier le plafond, le rappel et la coupure des notifications (`SKILL.md:20`, `:42`) : il renvoie à `agence pratiques show` et cite les options comme ponctuelles.
- **FR-015**: `declencheurs.json` MUST gagner un champ `nom` par ligne (libellé simple), ajouté à `CHAMPS_TABLE` (`agence.py:2047`) ; le choix `declencheurs.actifs` du formulaire l'affiche à la place de `commande`.
- **FR-016**: Les réglages natifs `cli*Enabled` MUST rester dans l'écran Réglages de Cate (aucune copie) ; le formulaire affiche une ligne « Accès des agents à Cate » qui ouvre la page `cli` (`openSettings('cli')`).
- **FR-017**: Chaque lot MUST commencer par ses tests rouges (constitution VI). Aucun test e2e ni Electron (constitution X).

### Key Entities

- **Champ publié** : `{ cle, nom, explique, groupe, portee, choix, defaut, valeur, origine }`, dérivé du schéma et de la politique par `pratiques.py`, jamais stocké hors de `state.json`.
- **Couche ponctuelle** : `st['ponctuel']`, objet `{ "<clé>": <valeur> }` écrit par `agence start`.
- **Premières questions** : les champs `essentiel` qui portent `question`.

## Success Criteria *(mandatory)*

- **SC-001**: Une personne non technique règle le plafond d'agents en 3 clics depuis le panneau (Réglages, choix, fin), sans terminal ni fichier.
- **SC-002**: 100 % des 16 réglages sont visibles et modifiables dans le formulaire ; 0 clé technique et 0 JSON visible (test Vitest sur le texte rendu).
- **SC-003**: Une seule source : pour 100 % des clés, la valeur et l'origine du formulaire sont celles de `agence pratiques show --json` (test Python qui compare `champs` et `show`).
- **SC-004**: 0 liste de clés, de valeurs ou de libellés recopiée dans `src/` : le test de la vue passe avec un schéma de fixture inventé (clés qui n'existent pas dans `pratiques.json`).
- **SC-005**: 100 % des refus ont une phrase humaine (test : chaque clé, une valeur hors liste, le message contient le `nom` et pas la clé).
- **SC-006**: Un nouveau workspace orchestré pose 4 questions au plus avant le premier démarrage de l'orchestrateur ; 0 question au second.
- **SC-007**: Écart avec upstream : 0 fichier hors `tools/agence/`, `skills/orchestrateur/`, `src/panels/agence/`, `src/shells/desktop/ui/panels/agence/`, `docs/architecture.md`.
- **SC-008**: Coût : 0 € par mois, 0 jeton (aucun appel de modèle). Effort : non chiffré en jetons (aucune mesure).

## Assumptions

- Le lot 2 de 005 est mergé avant le lot 1 de 008 (il supprime `MAX_AGENTS` et branche `plafond()` sur `agents.max`) ; 005-L5 est mergé avant le lot 3 de 008.
- Le panneau agence est desktop seul (aucune vue iOS, `ios/` et `src/shells/mobile/` ne citent pas l'agence) ; un client iOS ne voit pas le formulaire en v1.
- Les libellés sont en français, comme le reste de l'agence (Q4 de 005).
- Les alias `haiku`, `sonnet`, `opus` sont ceux que Claude Code accepte pour `--model` ; un autre agent CLI n'est pas visé (hors périmètre de 005).

## Questions ouvertes

Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** : une entrée « Agence » dans l'écran Réglages de Cate (Workspace > Agents) ? Hypothèse : **non en v1**. Le formulaire vit dans le panneau agence, seul endroit où ces réglages servent. Une page de l'écran Réglages demanderait une capacité qui lise l'état sans panneau ouvert : un lot de plus et un écart dans `ui/app/settings`. Ajout possible plus tard : une ligne qui ouvre le panneau sur ses réglages.
- **Q2** : 005-L2 (commit local `d0ac5108`) fait écrire `agents.max` dans le fichier du projet par `--max-agents`, ce que le point 4 de la demande interdit. Hypothèse : 005-L2 est mergé tel quel et le lot 2 de 008 change ce comportement (coupe nette, test de 005 remplacé). Si 005-L2 n'est pas encore mergé, plus simple : retirer l'écriture de T027 dans 005-L2 et garder l'ancien `st['maxAgents']` jusqu'à 008-L2.
- **Q3** : un réglage de portée `dev` (`envoi.slack.*`) écrit depuis le formulaire vise le fichier du dev de la machine du runtime, pas celui de la personne qui clique sur un autre poste. Hypothèse : acceptable en v1 (le runtime tourne sur le Mac de la personne) ; le formulaire le dit en une phrase sous le groupe Avancé.
- **Q4** : `seuil`, `repos` et `plafond` des déclencheurs (spec 004) restent hors formulaire. Hypothèse : oui, ils se révisent sur mesure (spec 004, `declencheurs bilan`), pas au goût de la personne.
- **Q5** : un budget par défaut par tâche (`--budget-usd`) ? Hypothèse : non en v1 ; une clé `agents.budget` se rajoute comme les autres (une entrée de schéma et un test).
- **Q6** : le nom de l'humain (`AGENCE_NOM`, gitconfig `agence.nom`, spec 002) dans le formulaire ? Hypothèse : affiché avec sa source, non éditable en v1 : la propriété en est à la spec 002, et le gitconfig est commun aux worktrees.
- **Q7** : choix des essentiels posés aux premières questions. Hypothèse : `livraison.mode`, `tests`, `verification`, `agents.max` (quatre questions, les plus lourdes de conséquence pour une personne non technique). Le modèle à appliquer n'est pas une question : les réponses en sont une version personnalisée de `neutre`.
- **Q8** : un troisième preset `main-direct` (POC, projet perso) ? Hypothèse : non, la demande dit « au minimum `neutre`, `pr-tdd` » et la Q3 de 005 (mode `main`) est ouverte.
- **Q9** : la session attend les premières questions avant de lancer l'orchestrateur. Hypothèse : oui (« avant tout ») ; un panneau ouvert en attente n'a pas de coût. Alternative : lancer l'orchestrateur tout de suite et lui faire attendre `projet: true`, ce qui coûte des tours de modèle.
