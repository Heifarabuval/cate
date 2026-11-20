---

description: "Tâches : apprentissage par observation (issue #76)"
---

# Tasks: Apprentissage par observation

**Input**: `specs/003-apprentissage-observation/` (spec.md, plan.md)

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit des fichiers tourne dans un dossier temporaire et échoue s'il voit le vrai `~/.cate`.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate` ou `~/.claude`. Pas de merge, de push sur `main`, de force-push, de suppression de branche. Aucune dépendance ajoutée.

**État** : lots 0 et 1 faits sur la branche `feat/observation-journal` (T011 non écrit, T026 attend un vérificateur). Les lots 2 à 5 attendent la décision de Heifara, et les questions Q1 à Q9 de spec.md attendent sa réponse avant le lot qui en dépend (Q1 : tranchée, hors du premier lot ; Q2 : tranchée, 3 fois en 14 jours ; Q4 : lot 5 ; Q5 et Q7 : hypothèses appliquées au lot 1, à confirmer ; Q9 : lot 4).

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US5]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (règles de non-capture, filtre du runtime, script de page : une erreur capte ce qu'il ne fallait pas).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur.
- Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).

## Lot 0 : sondes (0,5 j, avant tout code)

- [x] T001 [H] Heifara répond à Q1 (q409) : ligne de commande d'un terminal. Sans réponse, T002 s'exécute quand même et T003 reste fermé.
- [x] T002 [P] Sonde terminal : lire `src/services/terminal/runtime/terminalService.ts` et `shellResolver.ts`, noter si un hook de shell (zsh `preexec`, bash `DEBUG`) peut rapporter la ligne **soumise** sans lire d'entrée clavier, et ce que cela demande dans l'environnement du shell (variable, fichier généré dans `terminal-cli/`, jamais un fichier global). Livrable : une page dans le rapport du lot 0 (`specs/003-apprentissage-observation/rapport-lot-0.md`), verdict « possible / pas propre ».
- [x] T003 Si T001 répond « hook de shell » ou T002 conclut « possible » et que Heifara valide : planifier l'événement `terminal.command` en lot 1b. Sinon : retirer l'événement du FR-002 de la spec par une PR de spec.
- [x] T004 [P] Sonde page : lire `src/services/browser/desktop/pageDriver.ts` et `src/services/browser/contract/surface.ts`, noter comment injecter un script dans la page, s'il tourne dans un monde isolé, et comment un événement revient au client. Test jetable jsdom (hors dépôt, scratchpad) : un élément `autocomplete="cc-number"` est bien lisible par `el.autocomplete`. Livrable : rapport du lot 0.
- [x] T005 Relire le rapport avec Heifara : les sondes lèvent ou non les risques « terminal » et « script de page » du plan. Aucun lot ne démarre sans cette relecture.

## Lot 1 : journal du socle (3 j, US1)

**But** : un journal local, borné à 14 jours, qui ne s'écrit jamais sans accord, avec les événements du document et de navigation.

### Tests d'abord (à voir rouges)

- [x] T010 [P] [US1] `src/workspace/observation/contract/rules.test.ts` : `stripUrl` (requête, fragment, identifiants retirés ; `https://example.com/a/b?token=abc#x` donne `https://example.com/a/b`), `isSensitiveField` (`type=password`, `autocomplete` valant `cc-*`, `one-time-code`, `current-password`, `new-password`, et casse mixte, et valeurs composées « section-x cc-number »), `isExcludedDomain` (catégories par défaut, sous-domaines, domaine proche non exclu : `banque-exemple.fr` n'est pas `exemple.fr`). Vu rouge : fonctions absentes.
- [ ] T011 [P] [US1] (non écrit : T003 n'a pas validé l'événement, voir `rapport-lot-0.md`) `src/workspace/observation/contract/redact.test.ts` : corpus de lignes de commande avec et sans secret (`--password`, `Authorization: Bearer`, `API_KEY=`, URL avec identifiants, jeton collé) ; attendu : `***` ou ligne écartée en cas de doute. À écrire seulement si T003 valide l'événement.
- [x] T012 [US1] `src/workspace/observation/runtime/journal.test.ts` : état neuf, aucun dossier `observations/` ; sans accord, `append` n'écrit rien ; en pause, rien ; avec accord, une ligne `{ts, kind, panelType, ref}` dans `<AAAA-MM-JJ>.jsonl`, modes `0700`/`0600`, ajout seul ; une ligne invalide (kind inconnu, champ en trop, `ref` trop long) est rejetée.
- [x] T013 [P] [US1] `src/workspace/observation/runtime/purge.test.ts` : horloge simulée J-13 reste, J-14 reste, J-15 supprimé ; un fichier au nom invalide est ignoré, jamais supprimé ; la purge se base sur le nom, pas sur `mtime`.
- [x] T014 [P] [US1] `src/workspace/observation/runtime/sources.test.ts` : une création, une fermeture et une liaison de panneau du document produisent `panel.created`, `panel.closed`, `panel.linked` ; une navigation produit `navigate` avec l'URL sans paramètres ; une URL d'un domaine exclu ne produit rien.
- [x] T015 [P] [US1] `tools/agence/test_observe.py` : `agence observe list` sort une ligne par observation et le total, refuse sans réglage `cliObservationEnabled`, tolère une ligne illisible, sans écrire.
- [x] T016 [P] [US1] `src/workspace/observation/runtime/network.test.ts` : le module n'importe ni `ws`, ni `http`, ni `fetch`, ni un SDK de modèle (FR-018).

### Implémentation

- [x] T020 [US1] `src/workspace/observation/contract.ts` et `contract/{rules,exclusions,settings,capability,api}.ts` : types (`Observation`, `kind`), règles pures, catégories par défaut, slice `observation` (accord, pause, ajouts et retraits d'exclusions), capability, méthode `cate.observe.list` (read, gardée par `cliObservationEnabled`). Rend T010 vert.
- [x] T021 [US1] `src/workspace/observation/runtime/{journal,purge,index}.ts` : `createObservationRuntime(deps)`, ajout asynchrone par file mémoire bornée, garde d'accord et de pause, purge au démarrage puis une fois par jour. Rend T012 et T013 verts.
- [x] T022 [US1] Câblage dans `src/runtime/daemon/compose/` : sources document (créé, fermé, relié) et navigation par un port `observe(event)` ; ajouter `observations/` à `docs/architecture.md` section 7.2. Rend T014 vert. Les services n'importent que le contrat du module.
- [x] T023 [US1] `tools/agence/agence.py` : `observe list [--jours N] [--json]` appelle `cate observe list`. Rend T015 vert. Mise à jour de l'aide et de `skills/orchestrateur`.
- [x] T024 [US1] Registre `src/panels/api.ts` et `src/panels/runtime.ts` : l'entrée du module. `npm run lint:deps` vert (SC-006).
- [x] T025 [US1] [Mesure] SC-007 : écriture d'une ligne par événement, aucune lecture du journal dans le chemin critique ; chiffrer le surcoût sur 1000 créations simulées. Résultat dans le message de la PR.

### Vérification du lot

- [ ] T026 Un vérificateur relit le diff, relance `npm run typecheck`, `npm run lint`, `npm run lint:deps`, `npm test`, cherche une valeur d'entrée dans tous les fichiers produits et confirme 0 occurrence.

## Lot 2 : détecteur et carte de proposition (2 j, US2)

**But** : la même suite 3 fois en 14 jours devient une carte dans le panneau agence.

### Tests d'abord

- [ ] T030 [P] [US2] `src/workspace/observation/contract/detect.test.ts` : suites normalisées (types d'événement et `ref` généralisés : l'identifiant du panneau n'est pas une étape, le domaine l'est) ; 2 occurrences : 0 proposition ; 3 : 1 ; 3 dont 1 hors fenêtre : 0 ; suite de longueur 1 : écartée (longueur minimale) ; deux suites qui se chevauchent : la plus longue gagne.
- [ ] T031 [P] [US2] `src/workspace/observation/runtime/detector.test.ts` : une proposition refusée ne revient pas ; un domaine muet n'en produit plus ; une proposition ouverte ne se duplique pas ; l'état (`etat.json`) survit à un redémarrage ; fichier corrompu : mis en quarantaine par `kernel/state`.
- [ ] T032 [P] [US2] `src/panels/agence/session.test.ts` (ajouts) : l'instantané porte les propositions ; les ops `proposition.accept`, `proposition.refuse`, `proposition.mute` changent l'état ; une op sur une proposition inconnue échoue avec une erreur typée ; aucun effet de bord sur le projet.
- [ ] T033 [P] [US2] `src/shells/desktop/ui/panels/agence/PropositionCard.test.tsx` (jsdom) : la carte affiche la suite en phrases et le nombre d'occurrences ; trois boutons « Oui », « Pas utile », « Ne plus proposer pour ce domaine » ; double clic sur « Oui » : une seule op.

### Implémentation

- [ ] T034 [US2] `contract/detect.ts` (suites, fenêtre), `runtime/detector.ts` (état, déclenchement après chaque ajout groupé ou au démarrage), seuil dans une constante déclarée (Q2). Rend T030 et T031 verts.
- [ ] T035 [US2] `src/panels/agence/contract/types.ts` et `session.ts` : instantané et ops. Rend T032 vert. Le journal reste lu par le runtime ; l'instantané ne porte que les cartes (suite en phrases), jamais le journal brut (FR-018).
- [ ] T036 [US2] `src/shells/desktop/ui/panels/agence/PropositionCard.tsx` et son rangement dans `AgenceView.tsx`. Rend T033 vert. Texte des cartes en français, au nom de l'humain (spec 002, FR-003).
- [ ] T037 [US2] Mesure de bruit (M8) sur le journal d'un faux poste : nombre de cartes par jour ; seuil à revoir si plus de 3 par jour. Résultat dans la PR.
- [ ] T038 Vérificateur : même contrôle que T026, plus relecture de la carte à 375 px et 1280 px (jsdom, pas de fenêtre).

## Lot 4 : accord, pause, « Tout effacer » (2 j, US4)

**But** : l'utilisateur contrôle tout. À faire avant l'enregistrement (voir plan, « Écart avec l'issue »).

### Tests d'abord

- [ ] T040 [P] [US4] `src/workspace/observation/runtime/erase.test.ts` : « Tout effacer » supprime tous les `.jsonl`, `etat.json` et la liste des domaines muets, garde l'accord ; idempotent ; confirmation exigée ; retrait de l'accord efface aussi après confirmation ; un fichier ajouté pendant l'effacement est aussi supprimé ou le test échoue.
- [ ] T041 [P] [US4] `src/panels/agence/session.test.ts` (ajouts) : ops `observation.accord`, `observation.pause`, `observation.erase` ; l'état neuf ne crée rien ; un client distant reçoit les mêmes ops sans rôle spécial (D3).
- [ ] T042 [P] [US4] `src/shells/desktop/ui/panels/agence/AccordObservation.test.tsx` (jsdom) : l'écran liste ce qui est noté, la liste « jamais capté » du spec.md, l'emplacement des fichiers, la rétention de 14 jours, « rien ne quitte le Mac » ; il dit que l'usage par un collègue attend le cadre RGPD ; bouton d'accord désactivé tant que l'écran n'est pas déroulé ; bandeau de pause visible.
- [ ] T043 [P] [US4] `tools/agence/test_observe.py` (ajouts) : `agence observe erase` demande une confirmation, refuse sans `--oui` hors terminal interactif.
- [ ] T044 [US4] `src/workspace/observation/runtime/nonCapture.test.ts` : tests croisés : pour chaque ligne de la liste « jamais capté » du spec.md, un cas qui tente d'entrer par chaque source (document, navigation, enregistrement fixture, commande si T003) ; après tout le parcours (accord, événements, pause, événements, effacer), chercher dans tous les fichiers produits (journal, `etat.json`, `daemon.log`) chaque valeur d'entrée : 0 occurrence (SC-001).

### Implémentation

- [ ] T045 [US4] `runtime/erase.ts`, capability `grant`, `revoke`, `pause`, `erase`. Rend T040 vert.
- [ ] T046 [US4] Ops et instantané dans `src/panels/agence/`. Rend T041 vert.
- [ ] T047 [US4] `AccordObservation.tsx`, bandeau de pause, actions « Mettre en pause l'observation » et « Tout effacer » par `defineActions` (palette générée). Rend T042 vert.
- [ ] T048 [US4] `tools/agence/agence.py` : `observe erase`. Rend T043 vert.
- [ ] T049 [US4] Rend T044 vert : compléter les cas, jamais en affaiblissant le test.
- [ ] T050 Vérificateur : même contrôle que T026 ; relire à la main l'écran d'accord ligne à ligne contre le spec.md ; signaler tout écart.
- [ ] T051 [H] Heifara valide le texte de l'écran d'accord et la liste d'exclusion par défaut (Q7) avant le lot 3.

## Lot 3 : enregistrement du navigateur (4 j, US3)

**But** : un enregistrement démarré et arrêté à la main, qui capte des clics et des noms de champs, jamais de valeur.

### Tests d'abord

- [ ] T060 [P] [US3] `src/services/browser/desktop/recorder.test.tsx` (jsdom) : un clic sur un bouton produit `click` avec le libellé ; une saisie dans un champ produit `field` avec le nom, la valeur « ABC-123 » ne figure dans aucun message émis ; un champ sensible (T010) ne produit rien, ni nom, ni clic sur lui ; un clic sur une page d'un domaine exclu ne produit rien et émet « suspendu » ; frappes de touches, presse-papiers, `input` et `keydown` ne sont jamais écoutés (le test échoue si un écouteur `key*` est ajouté) ; arrêt : les écouteurs sont retirés (compter les `removeEventListener`).
- [ ] T061 [P] [US3] `src/workspace/observation/runtime/record.test.ts` : le runtime rejette un `record` hors enregistrement actif, un `kind` inconnu, un `ref` trop long, un champ sensible (filtre refait côté runtime), un domaine exclu ; borne de taille d'un lot ; un client qui n'a pas démarré l'enregistrement ne peut pas écrire.
- [ ] T062 [P] [US3] `src/panels/browser/session.test.ts` (ajouts) : ops `recording.start` et `recording.stop` ; `recording` dans l'instantané, jamais persisté (un redémarrage l'arrête) ; la fermeture du panneau et la pause arrêtent l'enregistrement ; refus sans `pageDriver` (`clientHas`).
- [ ] T063 [P] [US3] `src/shells/desktop/ui/panels/browser/RecordButton.test.tsx` (jsdom) : bouton, pastille rouge pendant l'enregistrement, pastille grise « Capture suspendue sur ce site » sur une page exclue, aucun enregistrement démarré par un événement de page.
- [ ] T064 [P] [US3] Test de non-fuite d'arrêt : après `recording.stop`, un clic et une saisie dans la page ne produisent aucun message (M10).

### Implémentation

- [ ] T065 [US3] `src/services/browser/desktop/recorder.ts` : script de page bundlé seul, règles de `contract/rules.ts`, écouteurs passifs limités à `click` et `focusout`/`change` (nom de champ), jamais `key*`, jamais la valeur. Si T004 montre qu'un monde isolé est impossible, s'arrêter et en parler à Heifara avant de continuer. Rend T060 vert.
- [ ] T066 [US3] `src/workspace/observation/runtime/record.ts` et capability `record`. Rend T061 vert.
- [ ] T067 [US3] Op `recording.start/stop` dans `src/panels/browser/` (`definePanel` : `commands` ou `chrome`, pas de menu écrit à la main) et opération `page.*` vers le client qui pilote la page (`contract/surface.ts`). Rend T062 vert.
- [ ] T068 [US3] `RecordButton` et la pastille dans `src/shells/desktop/ui/panels/browser/`. Rend T063 et T064 verts.
- [ ] T069 [US3] Liste d'exclusion : ajouts et retraits par l'utilisateur dans le panneau agence (retrait d'un domaine par défaut : confirmation). Test `exclusions.test.ts` d'abord.
- [ ] T070 Vérificateur : même contrôle que T026, plus un grep : aucun écouteur `key*` ni `clipboard` dans `src/services/browser/desktop/recorder.ts` (pas dans le dossier : `preload/guest.ts:80` écoute déjà `keydown` pour un signal sans contenu, voir `rapport-lot-0.md`).
- [ ] T071 [H] X001 : Heifara essaie sur son poste, sur une page de test locale (champs de tous types) puis sur un site de la liste d'exclusion : lire le journal avec `agence observe list`, confirmer 0 valeur, 0 champ sensible. Aucun agent ne lance l'app.

## Lot 5 : recette depuis un enregistrement ou une proposition (2 j, US5)

**But** : un texte relu et validé ; rien n'est écrit avant le clic.

- [ ] T080 [H] Heifara répond à Q4 : destination et format (fichier, skill, habitude du pack 007, panneau perso 008). Sans réponse, le lot 5 ne démarre pas.

### Tests d'abord

- [ ] T081 [P] [US5] `src/workspace/observation/contract/recipe.test.ts` : une suite fixture donne le texte attendu (une phrase par étape, ordre conservé) ; aucune valeur de champ ni contenu de page ; sorties identiques à entrées identiques (déterminisme) ; une étape de domaine exclu ne peut pas entrer dans une recette.
- [ ] T082 [P] [US5] `src/panels/agence/session.test.ts` (ajouts) : ops `recipe.generate`, `recipe.edit`, `recipe.validate` ; avant `validate`, aucun fichier n'est écrit dans le workspace ni dans un pack ; deux `validate` : une seule écriture.
- [ ] T083 [P] [US5] `src/shells/desktop/ui/panels/agence/RecettePreview.test.tsx` (jsdom) : le texte est éditable ; la version éditée est celle qui est gardée ; fermer sans valider n'écrit rien.

### Implémentation

- [ ] T084 [US5] `contract/recipe.ts` (gabarit déterministe, FR-014). Rend T081 vert.
- [ ] T085 [US5] Ops et destination choisie en T080 dans `src/panels/agence/session.ts`. Rend T082 vert.
- [ ] T086 [US5] `RecettePreview.tsx`. Rend T083 vert.
- [ ] T087 Vérificateur : même contrôle que T026 ; relecture : aucun appel à un modèle (FR-014, FR-018).

## Lot X : fin (0,5 j)

- [ ] T090 Mise à jour : `docs/architecture.md` (module `workspace/observation`, `observations/` en 7.2, capability, API), `CLAUDE.md` du fork (couches, liste des modules), `skills/cate-cli/references/` (méthode `cate.observe.*`), `skills/orchestrateur` (`agence observe`). Liste du code mort supprimé dans la PR (aucun attendu, module neuf).
- [ ] T091 Spec Skills `008-panneaux-perso` : ajouter `observations/` à la liste de refus fixe du pont `window.cate` (D7) et citer FR-017. Un changement dans un autre dépôt : le confier au projet Skills (issue ou orchestrateur de ce projet), pas depuis ce workspace.
- [ ] T092 Spec Skills `007-packs-metier` story 5 : noter que l'implémentation vit dans le fork (spec 003) et aligner le seuil (Q2). Même consigne que T091.
- [ ] T093 [H] X002 : parcours réel de Heifara (accord, quelques gestes, carte, « Oui », recette, « Tout effacer »). Rapport dans l'issue #76.
- [ ] T094 [H] Cadre RGPD avec la DG avant tout usage par un collègue (point mensuel). Ce point n'est pas une tâche d'agent : l'issue #76 reste ouverte tant qu'il n'est pas vu.
- [ ] T095 Fermer l'issue #76 seulement quand les lots 1 à 5 sont mergés ; chaque PR de lot écrit `Réf. #76`, la dernière écrit `Closes #76` (règle « issue réglée = issue fermée »).

## Dépendances et ordre

- Lot 0 d'abord (0,5 j). Lot 1 ensuite, seul.
- Lots 2 et 4 en parallèle possible après le lot 1 (deux agents, fichiers du panneau agence à coordonner : `types.ts`, `session.ts`).
- Lot 3 après le lot 4 (l'enregistrement ne vit jamais sans accord ni pause).
- Lot 5 après le lot 2 ou 3 et après la réponse Q4.
- Plafond d'agents du Mac : 4 agents Claude à la fois au maximum, un panneau fermé dès qu'il a fini.

## Couverture

| Récit | Tâches |
|---|---|
| US1 journal | T010 à T026 |
| US2 détecteur et carte | T030 à T038 |
| US3 enregistrement | T060 à T071 |
| US4 accord, pause, effacer | T040 à T051 |
| US5 recette | T080 à T087 |
| Menaces M1 à M10 | T010, T012, T016, T044, T061, T064, T070 ; M6 : T094 |
