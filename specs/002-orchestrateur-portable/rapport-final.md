# Rapport final : orchestrateur portable (spec 002, lot 5-B, X002)

Relu le 2026-11-20 sur `origin/main` `38789c7a` (vague 1 mergée : #114 test d'amorçage, #115 schéma des pratiques, #116 paquet de panneau, #117 mesure de l'attente). Lecture seule : aucun fichier de code touché, aucune fenêtre ouverte, aucun build lancé.

Légende : **prouvé** = une commande ou un `chemin:ligne` cité, relu ce jour ; **par test** = un test nommé qui échoue si la ligne casse ; **non vérifié** = aucune preuve disponible, dit pourquoi. Les numéros de ligne sont ceux de `38789c7a` : ils ont bougé depuis `tasks.md` (par exemple `HOOK_ENTREES` est à `agence.py:2541`, pas `:2501`) à cause de #115.

## Verdict

- Tout le code que la spec promet est livré. Aucun écart de fonctionnement relevé.
- Ce qui n'est pas prouvé tient en cinq points, tous du lot 5-C (essai réel de Max) : SC-001, SC-005 sur le dernier build, le terminal restauré, le Mac vierge, la durée du premier build.
- Reste hors fork : T044 et T050 (lot 5-D, dépôt Skills, T050 à faire avant lundi 2026-11-23), T014 (réglage de Heifara).

## Exigences fonctionnelles

| FR | Preuve | Statut |
|---|---|---|
| FR-001 CLI sur le PATH de tout terminal et du régisseur | Install : `src/runtime/daemon/contract/install.ts:93` (`agence`). Lanceur de terminal : `src/services/terminal/runtime/cateCli.ts:81`. Lanceur du régisseur : `src/runtime/daemon/compose/cliEnv.ts:55`. Fichiers livrés : `scripts/agence-files.mjs:9` (`agence`, `agence-hook`, `agence.py`, `pratiques.py`, `pratiques.json`). Tests : `cateCli.test.ts`, `cliEnv.test.ts`, `contract.test.ts`, `build-runtime-tarball.test.mjs`, `tools/agence/test_launcher.py`. Preuve de bout en bout : section « L1-17 » plus bas | prouvé |
| FR-002 skill `orchestrateur` livré | `skills/orchestrateur/SKILL.md` ; `scripts/build-runtime-tarball.mjs:161` (liste `required`) ; `src/workspace/skills/runtime/seed.test.ts` ; pureté : `tools/agence/test_portable.py`. Tarball réel non listé par `tar -tzf`, semis sur un vrai dépôt jamais vu | par test ; semis réel non vérifié (5-C, R6) |
| FR-003 nom : `AGENCE_NOM`, `git config agence.nom`, premier mot de `user.name`, « L'humain » | CLI : `tools/agence/agence.py:100-114` (`nom_source`), classes `Nom` et `NomDansLesTextes` de `test_agence.py`. Panneau : `src/shells/desktop/ui/panels/agence/SuiviList.tsx:12` (`À faire par {humain}`), `SuiviList.test.tsx` (« À faire par Max (2) »). Relevé ce jour : `agence nom` rend `Heifarabuval (git user.name)` | prouvé ; réglage de Heifara ouvert (T014) |
| FR-004 valeur stockée `heifara`, opaque, sans migration | `agence.py:91` (`OWNER_HUMAIN`), `src/panels/agence/contract/suivi.ts:9` ; la CLI affiche `humain`, le panneau le nom. Décision q303 | prouvé |
| FR-005 dépôt GitHub par `gh repo view`, aucun `/Users/` | `agence.py:412-415` (`gh_repo`) ; `test_portable.py` (grep `/Users/`), vert dans la suite du 2026-11-20 | prouvé |
| FR-006 pas d'échec si `osascript` manque | `agence.py:80-84` (`_run` rend 127 sur `OSError`), `:372-378` (`toast` journalise, ne lève pas). Aucun test dédié : principe VIII | prouvé par lecture |
| FR-007 `agence hooks install\|uninstall\|status`, idempotent, sauvegarde, Cate ne l'appelle jamais | `agence.py:2541` (`HOOK_ENTREES`), `:2615` (`ecrire_settings`), `:2673` (`cmd_hooks`). Tests en faux HOME : `test_hooks.py`, classes `Installation` (23 cas dont `test_deux_installs_valent_un_une_seule_sauvegarde`, `test_hooks_existants_intacts_entrees_agence_ajoutees_une_fois`, `test_lien_symbolique_la_cible_est_ecrite_le_lien_reste`) et `Desinstallation`. Parcours complet avec la vraie CLI : `test_quickstart.py` (#114). Relevé ce jour : `agence hooks status` rend `actif (~/.claude/settings.json)`, code 0. `CLAUDE.md` et `docs/architecture.md` disent que Cate ne lance jamais `agence hooks` | prouvé |
| FR-008 garde d'envoi : échec fermé ; garde des pages : peut échouer ouvert | `agence.py:2515-2531` (`cmd_guard`, toute exception en `ask`), `tools/agence/agence-hook`. Tests : `test_guard.py`, classe `EnvoiSansCli` (`test_current_absent_ask`, `test_agence_hook_non_executable_ask`, `test_python3_absent_ask`, `test_cli_en_echec_ask`), classe `Pages`. Relevé ce jour : `agence guard --mode send` sur un `slack_send_message` rend `permissionDecision: ask` ; `agence-hook send` sous `env -i` avec un HOME vide (aucun runtime, CLI introuvable) rend `ask`, code 0 | prouvé hors Claude Code ; la décision vue par Claude Code en réel : non vérifié (5-C, R9) |
| FR-009 `agence doctor --prerequis [--hors-cate]` | `agence.py:1858` (`DANS_CATE`), `:1861` (`prerequis`), `:1937` (`cmd_doctor`). Tests : `test_doctor.py` (27 tests, dont 6 `test_hors_cate_*` ; `Ran 27 tests`, `OK` ce jour) | par test ; lancé dans un terminal Cate réel : non vérifié (5-C, R6) |
| FR-010 le panneau affiche le garde et le nom | `src/panels/agence/contract/types.ts:106` (`garde: GardeState`), `RegisseurBanner.tsx:17-37` (bannière, minuterie de 5 s pour `inconnu`), `AgenceView.tsx:153`. Tests : `session.test.ts`, `AgenceView.test.tsx`, `SuiviList.test.tsx`. Aucune capture de l'app (constitution X) | par test ; rendu réel non vérifié (5-C, R7) |
| FR-011 mise à jour : build quand `origin/main` avance, app installée Cate fermé, aucun daemon arrêté, arrêt à la première erreur ; le client traite un autre build de même version comme plus ancien | `scripts/cate-fork-update.sh:232-235` (`CATE_SELF_UPDATE=0`) ; `grep -n kill scripts/cate-fork-update.sh` vide. Client : `src/client/connections/runtimeUpdate.ts:38-43` (`updateCandidate`, cas `order === 0` et builds différents). Tests : `cate-fork-install.test.mjs`, `runtimeUpdate.test.ts` | par test ; build réel sur Mac vierge non vérifié (5-C, R1 à R4, R12) |
| FR-012 rien de personnel à Heifara dans le fork | `grep -rnE "Heifara\|heifara\|U02FQHK9FPD\|/Users/"` sur `tools/agence/*.py`, `skills/orchestrateur`, `src/panels/agence`, `src/shells/desktop/ui/panels/agence` (hors tests et fixtures) : 2 lignes, `agence.py:91` et `suivi.ts:9` (la clé opaque). Test : `test_portable.py`, classe `Purete`. Reste Hermes : `agence.py` envoie les brouillons `slack:` avec le jeton de `~/.hermes/.env`, outil de Heifara, à régler par la spec 005 (plan, « Liens ») | prouvé pour le périmètre de SC-002 ; Hermes noté |
| FR-013 après la ligne, aucune commande ; gardes branchés (sauf `--sans-gardes`), `doctor --prerequis --hors-cate` lancé ; `--gardes` à la désinstallation | `scripts/cate-fork-install.sh:12-13` (`--sans-gardes`), `:91` (doctor), `:193` (`hooks install`), `scripts/cate-fork-uninstall.sh:55` (`hooks uninstall` avant `--purge`). Avec la vraie CLI, faux HOME, faux `git gh claude cate launchctl node npm` : `test_quickstart.py`, classe `Amorcage`, 6 tests : `test_premier_passage_branche_les_gardes_et_garde_l_existant`, `test_deuxieme_passage_ne_change_rien`, `test_sans_gardes_laisse_settings_octet_pour_octet`, `test_desinstallation_gardes_purge_rend_le_json_d_origine`, `test_refuse_le_vrai_home`, `test_rouge_sans_hooks_install`. Lancé ce jour sous `/usr/bin/python3` 3.9.6 : `Ran 6 tests`, `OK` ; empreinte de `~/.claude/settings.json` `743d7947fa71e016` avant et après | prouvé en faux HOME ; Mac vierge non vérifié (5-C, R1 à R5, R13) |

## Critères de réussite

| SC | Preuve | Statut |
|---|---|---|
| SC-001 Max : ligne collée à panneau ouvert en moins de 30 min, 0 fichier édité | seul le passage de Max le mesure ; le test d'amorçage prouve 0 commande après la ligne, en faux HOME, sans durée | **non vérifié** (5-C, R2 et R3) |
| SC-002 0 occurrence de « Heifara » dans le code livré | grep de FR-012 : `agence.py:91` et `suivi.ts:9`, la clé opaque de la liste blanche ; `test_portable.py` vert | prouvé |
| SC-003 `hooks install` deux fois = une fois ; `uninstall` rend l'original | `test_hooks.py` (`test_deux_installs_valent_un_une_seule_sauvegarde`, classe `Desinstallation`) ; avec l'amorçage : `test_quickstart.py` (deuxième passage : empreinte identique, une seule sauvegarde ; désinstallation : JSON égal à l'original hors ordre des clés) | prouvé par test |
| SC-004 `npm run test:agence` sous `/usr/bin/python3` 3.9.6 | CI : run 44399275161 sur `136d369a` (`main`), job `agence (macos-latest)` success, Python 3.9 (`.github/workflows/ci.yml:88-102`). Local, ce jour : `npm run test:agence` : `Ran 608 tests in 108.131s`, `OK` ; `test_quickstart` seul sous `/usr/bin/python3` 3.9.6 : `Ran 6 tests`, `OK` | prouvé |
| SC-005 0 régression : ses états existants s'ouvrent, sections identiques | T013 (copie d'un état réel de 197 besoins, `need list` identique à l'ancienne CLI hors colonne `humain`, empreinte de l'original inchangée), PR #63. `SuiviList.test.tsx` et `suivi.test.ts` couvrent la clé `heifara`. Non rejoué sur le build courant ni sur l'app | prouvé le 2026-11-19 ; non rejoué ce jour, rendu réel non vérifié (5-C) |

## L1-17 : le PATH, de bout en bout

Depuis un terminal Cate (runtime `2.1.0-beta.15+fc236063715e`), HOME jetable, environnement vidé, PATH réduit au dossier de lanceurs du terminal puis `/usr/bin:/bin` :

```shell
env -i HOME=<dossier-jetable> PATH=~/.cate/workspaces/<runtimeId>/terminal-cli/panels/<panelId>:/usr/bin:/bin agence --help
```

Sortie citée :

```text
usage: agence [-h] [--version]
              {start,boot,need,draft,ask,watch,doctor,guard,hooks,preview,observe,declencheurs,url,nom}
              ...

agence : l'univers d'un projet orchestré sur le canvas Cate.
```

Le même environnement avec `agence --version` rend `2.1.0-beta.15+fc236063715e`, égal à `cat ~/.cate/runtime/current`. Le lanceur du terminal contient `exec '~/.cate/runtime/2.1.0-beta.15+fc236063715e/agence/agence' "$@"` (réécrit à chaque spawn, `cateCli.ts:81`).

Contre-épreuve : `env -i HOME=<dossier-jetable> PATH=/usr/bin:/bin sh -c 'agence --help'` rend `sh: agence: command not found`. Le PATH du terminal est donc ce qui fournit la commande, rien d'autre sur la machine.

Ce que cette preuve ne couvre pas : un terminal restauré après relance de l'app (L0-02). Elle reste ouverte et passe en 5-C, ligne R11.

## Occurrences de « Heifara » hors code produit

Relevé : `git grep -nIiE heifara` hors `specs/`, hors lockfile, hors `tools/agence/test_*` et `tools/agence/fixtures`, hors `*.test.*`.

| Lieu | Contenu | Classe |
|---|---|---|
| `scripts/cate-fork-install.sh:4`, `:122` ; `scripts/cate-fork-install.md` (4) ; `scripts/cate-fork-update.sh:17`, `:384` ; `.specify/memory/constitution.md:3` ; `skills/panneau-perso/gabarit/sync-theme.mjs:31` | `Heifarabuval/cate` : URL du fork | adresse du fork |
| `scripts/agence-theme/harness.tsx:33` | cible d'exemple `Heifarabuval/cate#7` | adresse du fork |
| `src/panels/agence/contract/suivi.ts:9`, `tools/agence/agence.py:91` | clé stockée `heifara` | liste blanche (q303) |
| `src/panels/agence/contract/fixtures/{etat,sections}.json` | état figé de Heifara, texte « Bloquant de Heifara » | fixture de test, hors périmètre de SC-002 |
| `src/workspace/repository/contract/fixtures/pr-{view,files}.json` | auteur d'une PR réelle | fixture de test |
| `e2e/agence-panel.spec.ts:137`, `:163`, `:294` ; `e2e/fixtures/agence-fakes.ts:109` | « À faire par Heifara », `owner: 'heifara'` | fixture e2e (non exécutée, constitution X) ; **à corriger** si un test e2e doit passer sous un autre nom : la fixture ne pose pas `humain`, le panneau retombe sur « L'humain » et l'attendu `Heifara` est à relire |
| `docs/performance/main-process-memory-protocol.md:3` | « Owner of the run: Heifara » | **à corriger** (prénom dans un protocole du dépôt), sans risque |
| `src/workspace/observation/contract/exclusions.ts:7` | commentaire « Heifara completes it » | **à corriger** (spec 003, hors périmètre de cette spec) |

Aucune de ces lignes n'est dans le code produit de SC-002. Les trois « à corriger » sont signalées, pas traitées ici : ce lot ne change que deux fichiers de `specs/002-orchestrateur-portable/`.

## Écarts à la spec

- Numéros de ligne de `tasks.md` et `plan.md` périmés après #115 (`HOOK_ENTREES` `:2501` devient `:2541`, `doctor` `:1919-1921` devient `:1858-1937`). Le contenu est le même ; à réaligner à la prochaine passe sur les specs.
- `AGENCE_REQUIRED` a gagné `pratiques.py` et `pratiques.json` (#115, spec 005) : la liste de FR-001 n'est plus celle de la spec 002.
- `test_quickstart.py` ne prouve pas l'amorçage de bout en bout : `git`, `gh`, `claude`, `cate`, `launchctl`, `node`, `npm` y sont des faux (voulu, constitution X). Ce qu'il prouve avec la vraie CLI : l'ordre des appels, les gardes, la sauvegarde, l'idempotence, la désinstallation.

## Non vérifié

- SC-001 : durée et nombre de commandes d'un vrai passage ; durée du premier build (10 à 20 min annoncées, jamais mesurées).
- Mac vierge (sans CLT, sans nvm) : l'amorçage, le lanceur sans python3 (L0-01).
- Terminal restauré après relance de l'app (L0-02, ligne R11).
- Décision `ask` vue par Claude Code, et garde des pages face à un sous-agent (R9, R10).
- Semis de `.claude/skills/orchestrateur/SKILL.md` sur un vrai dépôt, tarball réel non listé (R6).
- Rendu réel du panneau : bannière du garde, section « À faire par Max » (R7) ; capture de `RuntimeMismatch.tsx` (L4B-03).
- Le workspace qui suit un nouveau build sans `pkill` (R12).
- T050 : « Ta journée » par Hermes avant lundi 2026-11-23, côté Skills ; non vérifié en réel.

## Suite

| Reste | Qui | Où |
|---|---|---|
| T014 : `git config --global agence.nom Heifara` ; contrôle : `agence nom` rend `Heifara (git agence.nom)` | Heifara | avant d'envoyer la ligne à Max |
| T049 : P1 à P7 et R1 à R13 de `tasks.md` | Max, relevé en lecture seule par un agent | section « Passage de Max » à ajouter à ce fichier |
| T044, T050 | projet Skills | dépôt Skills, hors fork |
| Cases de `tasks.md` à cocher par l'orchestrateur : T047 (preuve : #114, `test_quickstart.py`), X001, T048 et X002 (ce fichier) ; L1-17 coché pour `agence --help` seulement, « terminal restauré » reste ouvert | orchestrateur | `tasks.md`, hors des fichiers de ce lot |
