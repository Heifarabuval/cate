# Feature Specification: Apprentissage par observation (le fork propose des recettes)

**Feature Branch**: `docs/spec-apprentissage-observation`

**Created**: 2026-11-20

**Issue**: Heifarabuval/cate#76 (reste ouverte : elle porte l'implémentation). Besoin #n408. Dépend de #74 (fermée, skill `panneau-perso` en mode page).

**Status**: Draft. Spec d'abord, PR de la spec seule, aucun code. Questions ouvertes en fin de document (section « Questions ouvertes »).

**Input**: Heifara veut que l'outil apprenne en regardant l'utilisateur travailler dans ses propres panneaux : ses gestes répétés deviennent des recettes, des skills ou des panneaux. L'utilisateur valide dans le panneau agence ; rien n'est appliqué seul. Pas de capture du Mac entier. **Pas de frappes au clavier, nulle part.** Rien n'est décidé au-delà du texte de l'issue ; ce qui manque est posé en question, pas tranché ici.

Liens : spec Skills `008-panneaux-perso` (un panneau perso est une destination possible d'une proposition ; il ne lit jamais le journal, voir FR-017) et spec Skills `007-packs-metier` story 5 (« Cate apprend de ce que l'utilisateur fait » : cette spec en est la réalisation, avec un seuil différent, voir Q2).

## Clarifications

### Session 2026-11-20

- Q: Le journal quitte-t-il le Mac ? → A: non. Un fichier local par jour, jamais envoyé, jamais lu par un modèle de langage (tranché par Heifara, q413).
- Q: Qui valide ? → A: l'utilisateur, par un clic dans le panneau agence (principe de l'orchestrateur : seul le clic de l'humain applique).
- Q: Faut-il l'accord de la DG ? → A: avant tout usage **par un collègue**, oui, le cadre RGPD se voit avec la DG. Cette spec ne le tranche pas (voir « Cadre RGPD »). Pour l'usage de Heifara sur son propre poste, l'accord de l'écran d'accord suffit.
- Q: Seuil du détecteur ? → A: 3 fois en 14 jours (issue #76) ; la spec 007 dit 2. Tranché par Heifara (q411) : 3, réglable plus tard.
- Q: Comment lire la ligne d'une commande de terminal sans capter de frappes ? → A: tranché par Heifara (q409) : l'événement « commande de terminal » est hors du premier lot, précédé d'une sonde (lot 0). Voir Q1.

## Vocabulaire

- **Observation** : une ligne du journal `{ts, kind, panelType, ref}`. Un fait sur un panneau ou une page, jamais un contenu.
- **Journal** : les fichiers `~/.cate/workspaces/<runtimeId>/observations/<AAAA-MM-JJ>.jsonl`, un par jour, une observation par ligne.
- **Événement du socle** : une observation que Cate produit sans que l'utilisateur ait rien démarré : panneau créé, fermé, relié ; navigation ; commande de terminal (sous réserve de Q1).
- **Enregistrement** : une session démarrée et arrêtée à la main par l'utilisateur dans un panneau navigateur ; elle ajoute les clics (libellé) et les champs touchés (nom, jamais la valeur).
- **Suite** : la liste ordonnée des étapes d'une même séquence de gestes (types d'événement + `ref` normalisé). Deux suites sont « la même » si leurs étapes sont égales une à une.
- **Proposition** : une suite vue 3 fois dans les 14 derniers jours, montrée comme une carte dans le panneau agence.
- **Recette** : un texte ordonné d'étapes en phrases, généré depuis une suite ou un enregistrement validé, que l'utilisateur relit avant de le garder (format : Q4).
- **Liste d'exclusion** : domaines où rien n'est jamais capté, même avec un enregistrement actif.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un journal local et borné des gestes du socle (Priority: P1)

L'utilisateur active l'observation sur son accord (User Story 4). Cate écrit en local une ligne par panneau créé, fermé ou relié, et par navigation (URL sans paramètres). Rien d'autre. Les fichiers de plus de 14 jours disparaissent.

**Why this priority**: sans journal, ni détecteur ni recette. C'est aussi le premier lot livrable seul : il prouve que rien de sensible n'y entre.

**Independent Test**: dans un faux répertoire de données, rejouer une suite d'opérations de document et de navigations ; lire les lignes écrites ; comparer à une liste attendue. Rejouer avec des horloges de J-13, J-14, J-15 ; vérifier la purge.

**Acceptance Scenarios**:

1. **Given** l'accord donné, **When** l'utilisateur crée un panneau navigateur puis le relie à un panneau agent, **Then** deux lignes `{ts, kind, panelType, ref}` apparaissent dans le fichier du jour, `ref` portant l'identifiant du panneau et rien d'autre.
2. **Given** une navigation vers `https://example.com/a/b?token=abc#x`, **When** l'événement s'écrit, **Then** `ref` vaut `https://example.com/a/b` (ni requête, ni fragment, ni identifiants dans l'URL).
3. **Given** un fichier daté de 15 jours, **When** la purge tourne (au démarrage du runtime puis une fois par jour), **Then** le fichier est supprimé ; celui de 14 jours reste.
4. **Given** l'accord non donné, ou l'observation en pause, **When** un panneau est créé, **Then** aucun fichier n'est créé ni modifié.
5. **Given** `agence observe list`, **When** l'utilisateur la tape, **Then** les observations des 14 jours sortent en lecture seule, une ligne chacune, avec le total.

---

### User Story 2 - Une suite répétée devient une carte de proposition (Priority: P1)

La même suite d'étapes revient 3 fois en 14 jours. Une carte apparaît dans le panneau agence : la suite en phrases, trois boutons « Oui », « Pas utile », « Ne plus proposer pour ce domaine ». Rien n'est appliqué sans clic.

**Why this priority**: c'est la valeur visible de l'apprentissage. Sans carte, le journal ne sert à personne.

**Independent Test**: journaux fabriqués (fixtures) avec une suite à 2 occurrences, puis 3, puis 3 dont une hors fenêtre ; vérifier le nombre de cartes (0, 1, 0), et qu'une carte refusée ne revient pas.

**Acceptance Scenarios**:

1. **Given** la même suite vue 3 fois en 14 jours, **When** le détecteur tourne, **Then** une carte apparaît, une seule, avec la suite en phrases et le nombre d'occurrences.
2. **Given** une suite vue 2 fois, **When** le détecteur tourne, **Then** aucune carte.
3. **Given** une carte, **When** l'utilisateur clique « Pas utile », **Then** la même suite n'est plus proposée.
4. **Given** une carte sur le domaine `exemple.fr`, **When** l'utilisateur clique « Ne plus proposer pour ce domaine », **Then** plus aucune proposition ne vient de `exemple.fr`, et la liste des domaines muets est visible et modifiable dans le panneau.
5. **Given** une carte, **When** l'utilisateur clique « Oui », **Then** la proposition passe à la génération de recette (User Story 5) ; aucun fichier de l'utilisateur n'est écrit avant la validation du texte.
6. **Given** une carte ignorée (aucun clic), **When** 14 jours passent, **Then** elle disparaît avec ses observations ; elle ne bloque rien.

---

### User Story 3 - Un enregistrement démarré et arrêté à la main (Priority: P1)

Dans un panneau navigateur, l'utilisateur clique sur le bouton d'enregistrement : une pastille rouge s'affiche sur le panneau. Cate note chaque clic (libellé de l'élément) et chaque champ touché (nom du champ). Il clique de nouveau : l'enregistrement s'arrête, la pastille disparaît. Une page exclue suspend la capture et le dit.

**Why this priority**: c'est la seule source des clics et des champs ; sans elle, la recette ne sait décrire que des ouvertures de panneaux.

**Independent Test**: page de test locale avec des champs de tous les types ; démarrer, cliquer, remplir, arrêter ; lire le journal ; chercher chaque valeur saisie dans les fichiers (0 occurrence attendue).

**Acceptance Scenarios**:

1. **Given** un enregistrement démarré, **When** l'utilisateur clique sur le bouton « Valider la commande », **Then** une observation `click` avec le libellé « Valider la commande » s'écrit.
2. **Given** un champ « Référence client », **When** l'utilisateur y tape « ABC-123 », **Then** une observation `field` avec le nom « Référence client » s'écrit ; « ABC-123 » n'apparaît nulle part (journal, mémoire du runtime transmise, logs).
3. **Given** un champ `type=password`, ou `autocomplete` valant `cc-*`, `one-time-code`, `current-password` ou `new-password`, **When** l'utilisateur le touche, **Then** rien s'écrit, pas même le nom du champ.
4. **Given** une page d'un domaine de la liste d'exclusion, ou d'un gestionnaire de mots de passe, **When** l'enregistrement est actif, **Then** la pastille passe au gris avec « Capture suspendue sur ce site », rien s'écrit, et la capture reprend en quittant la page.
5. **Given** un enregistrement actif, **When** le panneau est fermé, l'app quittée ou l'observation mise en pause, **Then** l'enregistrement s'arrête.
6. **Given** aucun clic sur le bouton, **When** l'utilisateur navigue et clique, **Then** aucun clic ni champ n'est jamais capté (seuls les événements du socle existent).

---

### User Story 4 - Accord, pause et « Tout effacer » (Priority: P1)

Rien n'est observé tant que l'utilisateur n'a pas lu et accepté un écran d'accord, qui dit en phrases ce qui est noté, ce qui ne l'est jamais, où c'est stocké et pour combien de temps. Une pause coupe tout d'un clic. « Tout effacer » supprime le journal et les propositions.

**Why this priority**: sans contrôle, la fonctionnalité n'est pas acceptable, et le cadre RGPD en dépend.

**Independent Test**: état neuf : aucun fichier créé. Accord, événements, pause, événements : seuls les premiers sont écrits. « Tout effacer » : dossier `observations/` vide, propositions vides, accord conservé.

**Acceptance Scenarios**:

1. **Given** un workspace neuf, **When** l'utilisateur ouvre Cate, **Then** l'observation est coupée, aucun dossier `observations/` n'existe ; le panneau agence offre « Activer l'observation » qui ouvre l'écran d'accord.
2. **Given** l'écran d'accord, **When** l'utilisateur lit, **Then** il voit la liste de ce qui est noté, la liste « jamais capté » (FR-006), l'emplacement des fichiers, la rétention de 14 jours et le fait que rien ne quitte le Mac.
3. **Given** l'observation active, **When** l'utilisateur clique « Pause », **Then** plus rien s'écrit, un indicateur le montre dans le panneau agence, et un clic de plus reprend.
4. **Given** du journal et des propositions, **When** l'utilisateur clique « Tout effacer » et confirme, **Then** tous les fichiers du journal, les propositions et les domaines muets sont supprimés ; l'accord et l'état de pause restent.
5. **Given** le retrait de l'accord, **When** l'utilisateur le retire, **Then** l'observation s'arrête et le journal est effacé après confirmation.
6. **Given** un workspace B, **When** l'accord est donné dans le workspace A, **Then** B reste coupé (rien n'est partagé entre workspaces, décision D6 du fork).

---

### User Story 5 - Une recette générée depuis un enregistrement ou une proposition validés (Priority: P2)

L'utilisateur clique « Oui » sur une carte, ou « Faire une recette » après un enregistrement. Cate génère un texte d'étapes en phrases. L'utilisateur le relit et le modifie, puis le valide. Seul ce clic écrit quelque chose.

**Why this priority**: c'est la sortie utile, mais le journal et le détecteur ont déjà de la valeur seuls (voir leurs cartes). Dernier lot.

**Independent Test**: enregistrement fixture, génération, comparaison au texte attendu ; vérifier qu'aucune valeur de champ ni contenu de page n'y figure.

**Acceptance Scenarios**:

1. **Given** une proposition ou un enregistrement validé, **When** la génération tourne, **Then** le texte contient chaque étape en phrase (« Ouvrir un navigateur sur exemple.fr/commandes », « Cliquer sur Valider la commande », « Renseigner le champ Référence client »), sans valeur de champ.
2. **Given** le texte affiché, **When** l'utilisateur le corrige, **Then** sa version est celle qui est gardée.
3. **Given** une recette non validée, **When** la session se ferme, **Then** rien n'est écrit dans le projet de l'utilisateur ni dans un pack.
4. **Given** une recette validée, **When** elle est gardée, **Then** elle va à la destination choisie par l'utilisateur (Q4) ; Cate ne l'exécute pas seule.

### Edge Cases

- Horloge qui recule ou change de fuseau : les fichiers sont nommés par la date locale ; la purge se base sur la date du nom de fichier, pas sur `mtime`. Un fichier au nom invalide est ignoré et signalé, jamais supprimé.
- Deux clients ouverts sur le même workspace : un seul écrivain, le runtime (D3 et D1 du fork) ; les clients envoient des événements, ne touchent jamais au fichier.
- Disque plein ou fichier illisible : l'observation se met en pause et l'indique ; l'app et les panneaux continuent. Rien n'est écrit ailleurs.
- Fichier du journal édité à la main ou corrompu : la ligne illisible est ignorée par le détecteur et `agence observe list` ; le fichier n'est pas réécrit.
- Redémarrage du runtime : la pause, l'accord et les domaines muets persistent ; un enregistrement en cours ne reprend pas tout seul.
- Un site qui change `autocomplete` après coup, ou un champ ajouté dynamiquement : la règle est évaluée au moment du geste, sur l'élément réel.
- Iframe ou page cross-origin dans un enregistrement : la capture suit la règle du domaine de l'iframe ; si le domaine ne se lit pas, rien n'est capté.
- Une URL contient un jeton dans le chemin (`/reset/abc123`) : voir Q5 ; hypothèse de travail, les segments longs et aléatoires sont masqués par `*`.
- Une commande de terminal contient un secret hors des motifs connus : le motif ne le voit pas (risque connu, voir modèle de menaces M5) ; d'où le contrôle de l'utilisateur avant toute recette.
- Double clic sur « Tout effacer » : idempotent. Double clic sur « Oui » : une seule recette.
- Utilisateur qui change de métier (pack 007) : les propositions d'avant restent liées à leurs domaines, sans pack.

## Ce qui n'est JAMAIS capté

Liste ferme, vérifiée par des tests de non-capture (FR-015). Une ligne ajoutée à cette liste se teste avant d'être livrée ; une ligne retirée demande une décision de Heifara.

1. **Les frappes au clavier, nulle part** : ni touches, ni texte saisi, ni raccourcis, ni presse-papiers. Ce que le journal sait d'un champ, c'est qu'il a été touché, jamais ce qu'il contient.
2. **Les champs** `type=password`, ou `autocomplete` valant `cc-*` (`cc-number`, `cc-exp`, `cc-csc`, `cc-name`...), `one-time-code`, `current-password`, `new-password` : ni valeur, ni nom, ni libellé, ni la présence d'un clic.
3. **Les pages d'un gestionnaire de mots de passe** (la page de l'extension, le coffre ouvert dans le navigateur) : ni clics ni champs.
4. **La sortie des terminaux** : jamais lue, jamais journalisée. Seule la ligne soumise peut l'être (Q1), jamais ce qui s'affiche.
5. **Les domaines de la liste d'exclusion** : banque, mail, santé, RH, paie. Aucun événement, même du socle (pas même l'URL), même avec un enregistrement actif.
6. **Le contenu des pages** : texte, DOM, captures d'écran, cookies, stockage, en-têtes, corps de requêtes.
7. **Les valeurs des champs** : jamais, même hors des types ci-dessus. Seul le nom du champ s'écrit.
8. **Le Mac hors des panneaux de Cate** : aucune application tierce, aucun écran, aucune fenêtre qui n'est pas un panneau de Cate.
9. **Les fichiers du projet** : leur contenu n'entre jamais ; un événement de fichier, s'il existe, ne porte qu'un chemin relatif (hors périmètre de cette version, Q6).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le runtime MUST écrire le journal sous `~/.cate/workspaces/<runtimeId>/observations/<AAAA-MM-JJ>.jsonl`, une ligne `{ts, kind, panelType, ref}` par événement, en ajout seul. Dossier `0700`, fichiers `0600`.
- **FR-002**: Les événements du socle MUST être : `panel.created`, `panel.closed`, `panel.linked` (document) ; `navigate` (navigateur, `ref` = URL sans requête, sans fragment, sans identifiants) ; `terminal.command` (sous réserve de Q1, `ref` = ligne seule, secrets remplacés par `***`).
- **FR-003**: Rien MUST s'écrire sans l'accord de l'utilisateur dans ce workspace ; sans accord, aucun dossier `observations/` n'existe.
- **FR-004**: La pause MUST arrêter toute écriture immédiatement, y compris l'enregistrement en cours.
- **FR-005**: L'enregistrement MUST démarrer et s'arrêter sur un clic de l'utilisateur, afficher une pastille rouge sur le panneau tant qu'il est actif, et ne rien capter hors du panneau navigateur où il a démarré. Il capte les clics (`click`, libellé) et les champs touchés (`field`, nom, jamais la valeur).
- **FR-006**: La liste « jamais capté » (section ci-dessus) MUST s'appliquer en deux endroits : sur la page, avant tout envoi (le script ne transmet rien), et dans le runtime, à la réception (on ne fait pas confiance au client, qui peut être un autre appareil, D3). Un test par ligne de la liste.
- **FR-007**: La liste d'exclusion de domaines MUST venir avec des catégories par défaut (banque, mail, santé, RH, paie) et être modifiable par l'utilisateur (ajouter ; retirer un domaine par défaut demande une confirmation). Le contenu exact de la liste par défaut est à fournir au plan (Q7). La liste MUST s'appliquer aux sous-domaines.
- **FR-008**: Un secret dans une ligne de terminal MUST être remplacé par `***` avant l'écriture (jetons, `--password`, variables `*_KEY`/`*_TOKEN`/`*_SECRET`, en-têtes `Authorization`, URL avec identifiants). Une ligne qui contient un secret ET dont le motif reste douteux est écartée entièrement plutôt que partiellement masquée.
- **FR-009**: La rétention MUST être de 14 jours ; une purge MUST tourner au démarrage du runtime puis une fois par jour, en s'appuyant sur le nom du fichier.
- **FR-010**: Le détecteur MUST proposer une suite vue au moins 3 fois dans les 14 derniers jours (seuil : Q2), sans appel à un modèle de langage, sans autre donnée que le journal.
- **FR-011**: Une proposition MUST apparaître comme une carte dans le panneau agence avec trois actions : « Oui », « Pas utile », « Ne plus proposer pour ce domaine ». Aucun effet de bord sans clic ; une proposition ne se répète pas tant qu'elle est ouverte, refusée ou muette.
- **FR-012**: « Tout effacer » MUST supprimer tous les fichiers du journal, les propositions et la liste des domaines muets, après confirmation ; il garde l'accord. Il s'obtient aussi par `agence observe erase` (confirmation demandée).
- **FR-013**: La génération de recette MUST partir d'une proposition cliquée « Oui » ou d'un enregistrement, produire un texte en phrases sans valeur de champ, et ne rien écrire avant la validation du texte par l'utilisateur.
- **FR-014**: Le contenu d'une recette MUST être produit par un gabarit déterministe (une phrase par étape) ; l'usage d'un agent pour reformuler est hors périmètre (Q3, tranchée : 0 appel à un modèle).
- **FR-015**: Des tests de non-capture MUST exister pour chaque ligne de la liste « jamais capté », écrits avant le code (rouge d'abord), et tourner en CI. Un test cherche en plus chaque valeur d'entrée dans tous les fichiers produits (journal, état, logs du runtime).
- **FR-016**: `agence observe list [--jours N] [--json]` MUST lister le journal en lecture seule ; `agence observe erase` MUST effacer comme FR-012 ; aucune commande n'écrit une observation à la place de l'utilisateur.
- **FR-017**: Le journal MUST rester hors de portée des panneaux perso (spec 008) : il vit dans les données du workspace, hors racine du projet, et `observations/` entre dans la liste de refus fixe du pont `window.cate` (008, D7). Une proposition acceptée peut produire un panneau perso ; le panneau ne lit jamais le journal.
- **FR-018**: Le journal MUST rester local : aucune écriture réseau, aucun envoi à un modèle, aucune synchronisation, aucun partage entre appareils appairés. Un second appareil connecté au workspace peut afficher les cartes, pas lire le journal brut (voir M4).
- **FR-019**: Aucune dépendance ajoutée ; aucun service. Coût mensuel : 0 € (à confirmer au plan, voir Assumptions).
- **FR-020**: Respect des couches du fork (voir plan.md, « Constitution Check ») : contrats purs, journal et détecteur côté runtime, vue côté desktop, aucune branche sur le contexte local ou distant dans le code partagé.

### Key Entities

- **Observation** : `{ts (ISO 8601), kind, panelType, ref}`. `kind` ∈ `panel.created`, `panel.closed`, `panel.linked`, `navigate`, `terminal.command`, `click`, `field`. `ref` : identifiant de panneau, URL sans paramètres, ligne masquée, libellé ou nom de champ selon le `kind`. Aucun autre champ.
- **Proposition** : `{id, suite, occurrences, premiereVue, derniereVue, domaine, statut}` ; `statut` ∈ `ouverte`, `acceptee`, `refusee`, `muette`. Stockée dans `observations/etat.json` par `kernel/state`.
- **État d'observation** : `{accord: {donneLe}, pause, domainesMuets[], exclusionsAjoutees[], exclusionsRetirees[]}`, dans les réglages du workspace (slice déclarée par `defineSettings`) ou `etat.json` (au plan).
- **Recette** : texte en phrases + liste d'étapes structurées, brouillon tant qu'il n'est pas validé.

## Modèle de menaces

Qui peut nuire, par quoi, et la parade. Ce modèle se relit à chaque lot ; une menace sans test devient une tâche.

| # | Menace | Effet | Parade |
|---|---|---|---|
| M1 | Un secret entre dans le journal (mot de passe, carte, code à usage unique, jeton dans une URL ou une commande) | Fuite en clair sur le disque | Aucune valeur de champ jamais ; exclusion des types sensibles sur la page et dans le runtime (FR-006) ; masquage des URL et des commandes (FR-002, FR-008) ; tests de non-capture (FR-015) |
| M2 | Une page hostile ou compromise abuse du canal d'enregistrement pour écrire de fausses observations (empoisonner les propositions) | Proposition piégée (« lancer cette commande ») | La page ne parle jamais au runtime : le script d'enregistrement est injecté par le client, le canal est authentifié par la session ; le runtime valide le schéma, borne la taille, ignore un `kind` inconnu ; une recette ne s'exécute jamais seule (FR-013) |
| M3 | Un panneau perso ou un agent lit le journal et le réexpose | Fuite de l'historique | `observations/` hors racine et dans la liste de refus fixe du pont (FR-017) ; la lecture par la CLI (`agence observe list`) passe par un réglage dédié `cliObservationEnabled`, coupé par défaut (un agent qui lit le journal l'enverrait à un modèle, FR-018) |
| M4 | Un appareil appairé lit le journal brut | Fuite vers un autre appareil | Le journal ne traverse pas le protocole ; seules les cartes (suite en phrases) vont aux clients (FR-018) ; à confirmer au plan |
| M5 | Un secret hors des motifs connus passe dans une ligne de terminal | Fuite en clair | Hypothèse de travail : commande de terminal hors du premier lot (Q1) ; motifs larges, écarter la ligne en cas de doute (FR-008) ; l'utilisateur relit tout avant une recette |
| M6 | Un collègue est observé sans le savoir ou sans base légale | Risque juridique et de confiance (RGPD, droit du travail) | Accord explicite, local, par workspace ; pause et effacement visibles ; **aucun usage par un collègue avant le cadre RGPD vu avec la DG** (voir ci-dessous) |
| M7 | Le disque est copié ou sauvegardé (Time Machine, iCloud) avec le journal | Fuite hors Mac | Fichiers `0600`, rétention 14 jours ; limite connue : le chiffrement du disque reste à l'utilisateur ; non vérifié (NON VÉRIFIÉ au plan : exclure le dossier des sauvegardes ?) |
| M8 | Une suite trop générale (ex. « ouvrir un navigateur ») propose en boucle | Lassitude, désactivation | Seuil de 3, longueur minimale d'une suite, `Pas utile` et domaines muets ; mesure au plan |
| M9 | Une proposition acceptée applique une action irréversible | Dommage | Rien ne s'applique : la recette est un texte ; seul le clic de l'humain envoie ou exécute (principe de l'orchestrateur) |
| M10 | Le script d'enregistrement fuit hors de l'enregistrement (reste actif après l'arrêt) | Capture non voulue | Arrêt vérifié par test ; le script se désinstalle à l'arrêt, au changement de page exclue et à la fermeture du panneau |

## Cadre RGPD

**À voir avec la DG avant tout usage par un collègue** (avertissement de l'issue #76). Cette spec ne le tranche pas. Elle énumère ce qu'il faudra décider :

- Base légale et finalité : l'observation d'un salarié sur son poste n'est pas anodine, même locale. Qui est responsable du traitement ? Faut-il informer ou consulter les représentants du personnel ?
- Information de la personne : l'écran d'accord de cette spec (User Story 4) informe l'utilisateur ; il ne remplace pas une information de l'employeur.
- Minimisation et durée : 14 jours, aucune valeur, aucune frappe, exclusion des sites sensibles : la spec les prévoit ; la DG dira si c'est suffisant.
- Droit d'accès et d'effacement : `agence observe list` et « Tout effacer » (FR-012, FR-016) donnent le droit à la personne sur son poste.
- Données de santé, de paie, de RH : sur la liste d'exclusion ; la DG dira si la liste est complète.
- Statut : usage par Heifara sur son poste = lui seul décide ; usage par Max ou par un collègue = **bloqué** tant que ce point n'est pas vu. Le dire dans le panneau (la bascule « autres personnes » n'existe pas dans cette version).

## Success Criteria *(mandatory)*

- **SC-001**: 0 valeur de champ, 0 frappe et 0 donnée d'un champ sensible dans les fichiers produits, sur toutes les entrées des tests de non-capture (FR-015).
- **SC-002**: aucun fichier d'observation n'existe tant que l'accord n'est pas donné (test d'état neuf).
- **SC-003**: après 14 jours + 1, aucun fichier de plus de 14 jours ne subsiste (test d'horloge simulée).
- **SC-004**: « Tout effacer » laisse 0 fichier de journal et 0 proposition, et garde l'accord.
- **SC-005**: sur le journal fixture, le détecteur produit exactement les cartes attendues (0, 1, 0) et aucune carte pour une suite refusée ou muette.
- **SC-006**: `npm run lint:deps`, `npm run typecheck`, `npm run lint` et `npm test` verts à chaque lot.
- **SC-007**: surcoût de l'observation sur un workspace actif : à mesurer au lot 1 (écriture d'une ligne par événement, aucune lecture du journal dans le chemin critique) ; seuil à fixer au plan, aucune régression de latence de création de panneau visible.
- **SC-008**: recette lue par l'utilisateur avant toute écriture dans son projet : 100 % des recettes (test de la User Story 5).

## Assumptions

- macOS Apple silicon seulement (constitution, principe VIII).
- Coût mensuel : 0 € (aucun service, aucune dépendance ajoutée, aucun appel à un modèle). Confirmé par q413 : détecteur et recette sans modèle. Reformuler une recette avec un modèle coûterait des jetons et enverrait le journal : ce serait une autre décision.
- #74 est fermée (skill `panneau-perso` en mode page) ; la spec 008 (panneaux perso complets) n'est pas une dépendance : seule la liste de refus du pont (FR-017) la touche, au moment où elle est écrite.
- Le runtime reçoit les événements du document, du navigateur et du terminal par des ports que le composition root remplit ; ces trois sources existent déjà dans le fork (changements de document, navigation du panneau navigateur, service de terminal).
- La détection des suites se fait sur 14 jours glissants, par workspace.
- Les jours de l'issue (3 + 2 + 4 + 2 + 2 = 13 j) sont des estimations de Heifara ; le plan les redécoupe en lots testables.

## Questions ouvertes

Posées dans le panneau agence (q409, q411, q413) ou à poser. Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** (q409, tranchée par Heifara) : la ligne de commande d'un terminal. Le terminal du fork ne la connaît pas (octets du PTY). La lire depuis l'entrée serait capter des frappes (interdit). Décision : hors du premier lot, sonde d'abord (un hook de shell qui rapporte la ligne soumise, pas les touches).
- **Q2** (q411, tranchée par Heifara) : seuil du détecteur, 3 fois en 14 jours (issue) ou 2 (spec 007). Décision : 3, réglable plus tard (constante déclarée, T034).
- **Q3** (q413, tranchée par Heifara) : détecteur déterministe côté runtime, sans modèle de langage ; la recette est un texte généré depuis la suite, validé par clic. Décision : oui, 0 €.
- **Q4** : destination et format d'une recette validée : fichier Markdown du workspace, skill (`skills/`), habitude du pack métier (007, story 5, « Retenir cette habitude ? »), panneau perso (008) ? Hypothèse : le lot 5 livre un texte validé et la destination reste un choix à l'écran, à trancher avant ce lot.
- **Q5** : masquage des segments d'URL qui ressemblent à un jeton (`/reset/abc123`). Hypothèse : segments d'au moins 16 caractères alphanumériques sans espace remplacés par `*`.
- **Q6** : un événement « fichier ouvert » est-il voulu ? L'issue ne le cite pas. Hypothèse : non.
- **Q7** : contenu de la liste d'exclusion par défaut (banques, messageries, mutuelle, paie...) : qui la fournit, et la liste de l'orga d'Heifara (clients, outils de paie, RH) est-elle à lui demander ? Hypothèse : liste de départ écrite au plan, Heifara complète.
- **Q8** : durée maximale d'un enregistrement (arrêt automatique) : l'issue n'en parle pas. Hypothèse : aucun, l'arrêt reste à la main, la pastille rouge reste visible.
- **Q9** : les propositions et le journal pour un workspace partagé entre appareils (D3 du fork : aucun rôle par client). Hypothèse : le journal appartient au runtime ; tous les appareils appairés voient les cartes ; le journal brut n'est jamais servi. À valider avec Heifara avant le lot 4.
