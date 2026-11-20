---
name: panneau-perso
description: Créer un panneau perso en mode page : une page HTML dans .cate/panels/<id>/ ouverte dans le panneau navigateur de Cate, sans nouveau type de panneau. À lire quand la personne demande « fais-moi un panneau qui... », un mini-outil visuel (tableau, aperçu, convertisseur) à côté de ses agents, ou le partage d'un tel outil avec l'équipe.
---

# Panneau perso (mode page)

Un panneau perso est une page HTML ouverte dans un panneau navigateur. Aucun type de panneau nouveau, aucun build de Cate. Lis d'abord le skill `cate-cli` si tu ne l'as pas fait.

## Convention

Un panneau = un dossier `<root>/.cate/panels/<id>/` (`<id>` en kebab-case) :

- `cate-panel.json` : le manifeste. Gabarit : `gabarit/cate-panel.json` à côté de ce fichier.
- `index.html` : l'entrée. Gabarit : `gabarit/index.html`.
- `theme.css` : les couleurs du thème Cate actif, générées par `gabarit/sync-theme.mjs`.
- tout le reste (`app.js`, `style.css`, bibliothèques, données d'essai) dans le même dossier, en chemins relatifs.

Manifeste : `id`, `name`, `version`, `description`, `author`, `icon` (nom lucide), `entry`, `size` (`width`, `height`), `permissions` (`files.read` et `files.write` en globs relatifs à la racine du workspace, `network` en liste d'hôtes, `links.receive`, `links.emit`), `inputs` optionnel (libellés des champs). C'est le format du futur type `app`.

**Les permissions sont déclaratives. Rien ne les applique en mode page** : la page tourne comme une page web ordinaire (réseau ouvert, même origine que les autres pages du serveur de fichiers). Elles disent ce que le panneau doit faire. Respecte-les dans ton code : `network: []` veut dire aucun appel sortant.

## Créer

1. Copie `gabarit/` dans `.cate/panels/<id>/`, remplis le manifeste, écris la page, puis génère le thème (section Thème).
2. Une bibliothèque (SheetJS, Chart.js...) est un fichier `.js` copié dans le dossier, récupéré **une seule fois, à la création**, version fixée dans l'URL, puis chargé par `<script src="lib.min.js">`. Aucun appel réseau à l'exécution, aucun CDN dans le HTML. Exemple SheetJS :
   `curl -fsSL -o .cate/panels/<id>/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`
   Ne commite pas de bibliothèque minifiée dans le dépôt de Cate. Dans un projet d'équipe, elle suit le panneau.
3. Données d'essai : petits fichiers dans le dossier du panneau. La page les charge par chemin relatif (`fetch('a.xlsx')`) ou par `<input type="file">`.
4. Ouvre la page dans un panneau navigateur :
   ```bash
   cate panel create browser file:///<racine>/.cate/panels/<id>/index.html
   ```
   **Chemin ABSOLU obligatoire** (`file:///...` ou `/Users/...`). Un chemin relatif est lu comme un nom d'hôte (`https://.cate/`, `ERR_NAME_NOT_RESOLVED`). Si `cate browser` rend `webview-not-ready`, ferme le panneau (`cate panel close <id>`) et ouvres-en un neuf. Le chemin est servi par le serveur de fichiers du runtime (HTTP local, un jeton par dossier, la page n'atteint que son dossier). Workspace non approuvé : le HTML est servi en texte et la page ne s'affiche pas. Demande l'approbation à la personne.
5. Relie le panneau à l'agent créateur (toi) pour qu'il le pilote et lise ce qu'il affiche :
   ```bash
   cate panel link <ton-id> <id-du-panneau> --kind context
   ```
6. Vérifie avec `cate browser snapshot --panel <id-du-panneau>` : le contenu attendu est dans l'arbre. Fais afficher à la page un décompte (lignes lues, lignes sans correspondance) pour contrôler un calcul sans deviner. Après une retouche : `cate browser reload --panel <id-du-panneau>`.

## Thème

Une page a une autre origine que Cate : elle n'hérite pas de ses variables CSS. Le gabarit a donc un `theme.css` qui définit **toutes les variables de Cate** (celles de `globals.css`, `:root`) : `--font-sans`, `--hairline`, `--surface-0` à `--surface-6`, `--border-subtle`, `--border-strong`, `--border-focus`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--focus-blue`, `--activity-green`, `--activity-orange`, `--git-*`, `--surface-hover`, `--surface-hover-strong`, `--scrollbar-thumb`, etc. Même résultat que `applyTheme` : base claire ou sombre du thème, surchargée par ses valeurs. `index.html` n'utilise que ces variables : jamais `#...`, `rgb(...)` ou `hsl(...)` en dur. Seule exception : `white` sur le bouton plein, comme `Button.tsx`.

À la création, et chaque fois que la personne change de thème, régénère `theme.css` depuis le thème actif :
```bash
node .cate/panels/<id>/sync-theme.mjs .cate/panels/<id>
```
Le script lit `activeThemeId` dans `~/Library/Application Support/cate/settings.json` (lecture seule). `system` donne `systemLightThemeId` ou `systemDarkThemeId` selon le Mac. Un thème perso vient de `customThemes`. Un thème intégré vient de `src/kernel/interaction/contract/themes/<id>.ts` sur `origin/main` d'un checkout Cate (`--cate <dossier>` ou `CATE_REPO`, sinon `gh api` sur le fork), fusionné sur `base.ts`. Option `--settings <fichier>` pour lire une copie. Hors du repo Cate, le script suppose `gh` connecté.

Le suivi en direct du thème viendra avec le type `app` (SDK). En mode page, le thème est figé à la génération : après un changement de thème, relance le script puis `cate browser reload`.

## Identité Cate : checklist design

Un panneau doit se lire comme un panneau Cate. Le gabarit reprend les valeurs de `Button.tsx`, de `globals.css` et des vues review ; garde-les. Mode Operate du skill `impeccable` (archivé dans `~/.claude/archive/skills/impeccable/SKILL.md`) : précision et retenue, pas de décor.

- Fond `--surface-1`, bandeau de titre `--titlebar-bg` avec un titre de 13 px, `font-weight: 500`. Pas de `h1` géant. Titres de section en 11 px, `--text-muted`.
- Texte de 12 px (13 px pour boutons et champs), `var(--font-sans)`, `tabular-nums` dans les tableaux. Espacement `--s1` à `--s4` (4, 8, 12, 16 px), rayon 6 px, bordures `var(--hairline)`.
- Aucun élément natif non stylé : boutons, champs, `input type=file` (`::file-selector-button`), `select`, barre de défilement, tout vient du gabarit.
- Bouton principal : plein, `--focus-blue`. Les autres : bordure fine `--border-subtle`, survol `--surface-hover`.
- Champs : bordure fine, focus = bordure `--border-focus` sans contour autour du texte. `:focus-visible` des boutons : anneau `--border-focus`.
- États présents : survol, focus, désactivé (opacité 0,4), vide (`.empty`), erreur (`.error`, message en clair, liseré `--git-deleted`), statut en pastilles (`.pill`, point `--activity-green` ou `--activity-orange`).
- Tableaux denses : lignes fines, en-tête 11 px discret, défilement horizontal dans `.scroll`, 20 lignes d'aperçu puis « N lignes de plus ».
- Contraste : texte courant en `--text-primary` ou `--text-secondary`. `--text-muted` seulement pour les libellés et en-têtes. Le texte blanc du bouton plein suit Cate (environ 4:1 sur one-light) : ne l'utilise pas pour du texte long.
- Responsive : vérifie à 375, 834 et 1280 px (`cate browser viewport custom --width 375 --height 800`, puis `cate browser screenshot`). Pas de défilement horizontal de la page.

Limite : en mode page, le panneau est entouré de la barre d'onglets et d'adresse du navigateur Cate, qu'on ne peut pas masquer. Ne cherche pas à la contourner. Seul le futur type `app` (vue sans chrome de navigateur) rendra un panneau 100 % natif.

## Limites du mode page

- **Aucune écriture dans le workspace** : le serveur est en lecture seule (GET). Un export passe par un téléchargement (`<a download>` sur un `Blob`) ; l'agent déplace ensuite le fichier téléchargé si besoin (`cate browser downloads`).
- Pas de messages typés entre panneaux : un lien passe par l'agent, qui lit la page (`snapshot`) et la pilote (`fill`, `click`). Lent et fragile : réserver aux petits outils.
- Pas d'accord utilisateur, pas d'isolation d'origine par panneau.
- Un calcul sensible (fusion, dates Excel, types de cellules) affiche toujours son décompte pour être vérifié.

## Partage

Panneau d'équipe : le dossier est commité sous `<root>/.cate/panels/<id>/`. `.cate/.gitignore` ignore tout sauf `skills.json` : ajoute `!panels/` et `!panels/**` dans le projet concerné, avec l'accord de la personne. Dans le dépôt Cate lui-même, le `.gitignore` racine ignore aussi `.cate/`.
