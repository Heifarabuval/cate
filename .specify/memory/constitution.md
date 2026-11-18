# Constitution du fork Cate

Fork `Heifarabuval/cate`. Source des règles d'architecture : `CLAUDE.md` et
`docs/architecture.md` (le document gagne sur le code).

## Principes

### I. Couches et côtés
`src/` est découpé en couches (du bas vers le haut : `kernel`, `runtime`, `workspace`,
`services`, `client`, `panels`, `shells`) et, dans chaque module, en côtés (`contract`,
`runtime`, `node`, `client`, `desktop`). Un module importe sa couche ou une couche plus basse.
Un contrat est pur et n'importe que des contrats. Entre modules, on importe un contrat ou le
`index.ts` d'un côté, jamais ses internes. Une couche basse qui a besoin d'une couche haute
expose un slot que la haute remplit.
Vérifié par : `npm run lint:deps`. Une PR qui le casse n'est pas mergée.

### II. Déclarer une fois
Capabilities, méthodes de l'API `cate`, réglages, actions et types de panneau se déclarent une
seule fois (`defineCapability`, `defineCateApi`, `defineSettings`, `defineActions`,
`definePanel`) et se consomment de façon générique. Aucune liste écrite à la main dans un menu,
une palette ou une CLI.

### III. Coupes nettes
Pas de code de migration, pas de shim, pas de réexport depuis un ancien chemin. Ce qu'un
changement rend inutile (fonction, option, doc, test) est supprimé dans le même changement.

### IV. Pas de branchement sur le contexte dans le code partagé
Le code partagé ne branche jamais sur local ou distant, sur desktop ou un autre client, ni sur
un type de panneau. Ce qu'un client sait faire se demande par une fonction déclarée
(`clientHas(feature)`).

### V. Le runtime est l'application
Tout ce qui n'est ni rendu, ni saisie, ni primitive native de l'OS vit dans le côté `runtime/`
d'un module, jamais dans le shell desktop. Les vues demandent, les sessions agissent. Un
enregistrement d'état ne tue ni ne relance jamais une ressource.

### VI. Tests d'abord pour la logique (non négociable)
Toute logique et tout correctif de bug commence par un test qui échoue pour la bonne raison,
écrit et vu rouge avant le code. Un test ne passe jamais en vert par un faux ou un mock qui
contourne ce qu'il doit prouver. Les chemins qui lancent un processus externe se testent avec
un faux exécutable sur le PATH ou un dossier temporaire.

### VII. Le plus simple d'abord
Dans l'ordre : ce qui existe déjà dans le dépôt, la bibliothèque standard, une fonction native
de la plateforme, une dépendance déjà installée, une ligne. Pas de dépendance, d'option ni de
couche ajoutée sans besoin prouvé. La logique métier reste côté serveur ou runtime.

### VIII. Cible macOS Apple silicon seule
Le fork vise macOS arm64. Aucun test ni plan Windows ou Linux. Une capacité propre à macOS
(clonefile APFS par `cp -c`, `osascript`) est permise ; sa dégradation sur une autre plateforme
est une absence d'effet sans erreur, pas un chemin à maintenir.

### IX. Écart minimal avec upstream
`main` du fork suit `origin/main` du fork et, à travers lui, upstream. Tout écart dans `src/`
se porte à chaque synchro : il est petit, justifié par écrit dans la PR, et signalé comme écart.
Ce qui peut vivre hors de `src/` (`tools/`, scripts) y vit.

### X. Aucune fenêtre lancée par un agent
Un agent ne lance ni Playwright, ni Electron, ni l'app Cate, ni `npm run dev`, et n'ouvre
aucune fenêtre par-dessus le travail de l'humain. Un test e2e s'écrit, il ne s'exécute pas :
le rapport dit « non exécuté ». `npm ci` et `npm install` sont de même interdits à un agent
tant que la décision de l'humain n'est pas prise.

## Contraintes

- Les fichiers que le code lit et écrit pour l'utilisateur restent du JSON éditable à la main,
  écrit par un seul processus.
- Le français, des phrases courtes, jamais de tiret long, dans les docs, les messages de
  commit et les PR.
- Aucune attribution d'outil dans les commits et les PR.
- Branche dédiée et Conventional Commits avec scope. Jamais de push sur `main`, de force-push
  ni de suppression de branche par un agent.

## Flux de travail

- Une fonctionnalité de plus d'une journée passe par spec-kit : constitution, specify,
  clarify, plan, tasks, implement.
- Les tâches d'un plan se groupent en lots sans fichier commun, pour s'exécuter en parallèle.
  Dans un lot, les tests viennent avant le code.
- Avant une PR : `npm run typecheck`, `npm run lint`, `npm run lint:deps`, `npm test` et, pour
  `tools/agence/`, `npm run test:agence`. Toute vérification non exécutée est dite non vérifiée.
- Une PR dit ce qu'elle supprime, ce qu'elle ajoute comme écart avec upstream, et s'il faut un
  redéploiement ou une relance de Cate.

## Gouvernance

La constitution prime sur les autres pratiques du dépôt. Chaque PR vérifie sa conformité ;
une complexité ajoutée se justifie par écrit. Un amendement passe par une PR qui modifie ce
fichier, dit la raison et le numéro de version. Versionnage : MAJOR pour un principe retiré ou
redéfini, MINOR pour un principe ou une section ajouté ou élargi, PATCH pour une clarification.
Guide d'exécution : `CLAUDE.md`.

**Version**: 1.0.0 | **Ratifiée**: 2026-11-18 | **Dernier amendement**: 2026-11-18
