---
name: panneau-perso
description: Créer un panneau perso : un dossier ~/.cate/panneaux/<id>/ (manifeste cate-panel.json et page HTML) que Cate charge sans recompiler et propose dans le menu du canvas. À lire quand la personne demande « fais-moi un panneau qui... », un mini-outil visuel (tableau, aperçu, convertisseur) à côté de ses agents, ou le partage d'un tel outil.
---

# Panneau perso

Un panneau perso est un dossier que tu écris dans `~/.cate/panneaux/<id>/`. Cate le détecte tout seul (moins de 2 s), le met dans le menu du canvas sous son nom, et le sert dans un cadre isolé. Aucun build de Cate, aucun type de panneau à ajouter. Lis d'abord le skill `cate-cli` si tu ne l'as pas fait.

## Le dossier

`<id>` est en kebab-case ASCII (`apercu-excel`) et **égal au champ `id` du manifeste**. Sinon le panneau est refusé.

- `cate-panel.json` : le manifeste. Gabarit : `gabarit/cate-panel.json`.
- `index.html` : la page. Gabarit : `gabarit/index.html`.
- `app.js` : le JavaScript de la page. Gabarit : `gabarit/app.js`.
- `theme.css` : les couleurs du thème Cate actif, générées par `gabarit/sync-theme.mjs`.
- tout le reste (`style.css`, bibliothèques, données d'essai) dans le même dossier, en chemins relatifs.

## Le manifeste

Trois champs à inventer : `name`, `description`, les permissions. Le reste a un défaut.

```json
{
  "schema": 1,
  "id": "apercu-excel",
  "name": "Aperçu Excel",
  "description": "Affiche les premières lignes d'un fichier Excel choisi à la main.",
  "icon": "table",
  "entry": "index.html",
  "size": { "width": 900, "height": 600 },
  "permissions": { "files": { "read": [] }, "network": [], "links": { "receive": [], "emit": [] } },
  "tasks": []
}
```

| Champ | Règle |
|---|---|
| `schema` | `1`. Un autre nombre : refusé (« version de format inconnue »). |
| `id` | kebab-case, égal au nom du dossier. |
| `name` | 1 à 40 caractères : le libellé du menu. |
| `description` | Une phrase. |
| `icon` | `layout-dashboard` (défaut), `table`, `file-text`, `chart-bar`, `calculator`, `calendar`, `image`, `list-checks`, `terminal`, `globe`, `folders`, `grid`, `git-compare`, `briefcase`. Un autre nom retombe sur le défaut, avec un avertissement. |
| `entry` | Défaut `index.html`. Chemin relatif au dossier, jamais `..`. |
| `size` | Défaut 900 x 600. |
| `permissions.network` | Liste d'hôtes (`api.exemple.fr`, `*.exemple.fr`, `localhost:8080`). Défaut `[]` : aucun appel sortant. Le strict minimum. |
| `permissions.files`, `links`, `tasks` | Acceptés et signalés dans la liste, **sans effet au jalon 1** : le pont vers les fichiers du workspace, les messages entre panneaux et les tâches arrivent aux jalons 2 et 3. `files.write` est ignoré et signalé. |

Un champ inconnu est un avertissement, jamais une erreur. Un manifeste invalide donne une phrase dans la page « Panneaux perso » (entrée du menu qui n'apparaît que lorsqu'un dossier est en erreur) : corrige-le, le panneau revient sans redémarrage.

## Ce que la page peut et ne peut pas faire

Cate sert la page avec une politique stricte et la met dans un webview à part (partition vide, aucun accès à Node ni à Cate) :

- **Pas de script en ligne** : tout le JavaScript va dans `app.js` (`<script src="app.js">`). Un `<script>` avec du code dans le HTML, un `onclick="..."` ou `eval` sont bloqués.
- **Pas de script distant, pas de CDN** : une bibliothèque (SheetJS, Chart.js...) est un fichier copié dans le dossier **une seule fois, à la création**, version fixée dans l'URL, puis chargée par `<script src="lib.min.js">`. Exemple : `curl -fsSL -o ~/.cate/panneaux/<id>/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`.
- **Pas de réseau** sauf les hôtes de `permissions.network`.
- **Pas de lecture du workspace** au jalon 1 : la personne choisit un fichier avec `<input type="file">`, la page le lit par `FileReader`. Données d'essai : petits fichiers dans le dossier du panneau, chargés par chemin relatif.
- Un export passe par un téléchargement (`<a download>` sur un `Blob`).

## Créer

1. Copie `gabarit/` dans `~/.cate/panneaux/<id>/`, remplis le manifeste, écris `index.html` et `app.js`, puis génère le thème (section Thème).
2. Ne crée rien dans `<workspace>/.cate/panels/` : cet ancien emplacement n'est plus lu.
3. Dis à la personne que le panneau est dans le **menu du canvas** (clic droit sur le canvas) et dans la palette, sous son `name`. Au premier lancement, Cate affiche une carte d'accord en une phrase : **rien de la page ne tourne avant le clic sur Autoriser**. Un workspace non approuvé n'ouvre aucun panneau perso : demande l'approbation à la personne.
4. Tu retouches un fichier du dossier : le panneau se recharge seul en moins de 2 s. Retoucher les permissions (le manifeste) redemande l'accord ; retoucher la page ne le redemande pas.
5. Vérifie ce que tu peux : `node --check ~/.cate/panneaux/<id>/app.js`, le JSON du manifeste, et fais afficher à la page un décompte (lignes lues, lignes sans correspondance) pour que la personne contrôle un calcul sans deviner. La vérification à l'écran est la sienne : demande-lui ce qu'elle voit.

`cate app open <id>` (ouvrir un panneau précis depuis la CLI) arrive au jalon 2. D'ici là, c'est le menu ou la palette.

## Thème

Une page a une autre origine que Cate : elle n'hérite pas de ses variables CSS. Le gabarit a donc un `theme.css` qui définit **toutes les variables de Cate** (celles de `globals.css`, `:root`) : `--font-sans`, `--hairline`, `--surface-0` à `--surface-6`, `--border-subtle`, `--border-strong`, `--border-focus`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--focus-blue`, `--activity-green`, `--activity-orange`, `--git-*`, `--surface-hover`, `--surface-hover-strong`, `--scrollbar-thumb`, etc. `index.html` n'utilise que ces variables : jamais `#...`, `rgb(...)` ou `hsl(...)` en dur.

À la création, et chaque fois que la personne change de thème, régénère `theme.css` depuis le thème actif :
```bash
node ~/.cate/panneaux/<id>/sync-theme.mjs ~/.cate/panneaux/<id>
```
Le script lit `activeThemeId` dans `~/Library/Application Support/cate/settings.json` (lecture seule). `system` donne `systemLightThemeId` ou `systemDarkThemeId` selon le Mac. Un thème perso vient de `customThemes`. Un thème intégré vient de `src/kernel/interaction/contract/themes/<id>.ts` sur `origin/main` d'un checkout Cate (`--cate <dossier>` ou `CATE_REPO`, sinon `gh api` sur le fork), fusionné sur `base.ts`. Option `--settings <fichier>` pour lire une copie. Hors du repo Cate, le script suppose `gh` connecté. Le thème est figé à la génération ; le suivi en direct viendra avec le pont (jalon 2).

## Identité Cate : checklist design

Un panneau doit se lire comme un panneau Cate. Le gabarit reprend les valeurs de `Button.tsx`, de `globals.css` et des vues review ; garde-les. Précision et retenue, pas de décor.

- Fond `--surface-1`, bandeau de titre `--titlebar-bg` avec un titre de 13 px, `font-weight: 500`. Pas de `h1` géant. Titres de section en 11 px, `--text-muted`.
- Texte de 12 px (13 px pour boutons et champs), `var(--font-sans)`, `tabular-nums` dans les tableaux. Espacement `--s1` à `--s4` (4, 8, 12, 16 px), rayon 6 px, bordures `var(--hairline)`.
- Aucun élément natif non stylé : boutons, champs, `input type=file` (`::file-selector-button`), `select`, barre de défilement, tout vient du gabarit.
- Bouton principal : plein, `--focus-blue`. Les autres : bordure fine `--border-subtle`, survol `--surface-hover`.
- Champs : bordure fine, focus = bordure `--border-focus` sans contour autour du texte. `:focus-visible` des boutons : anneau `--border-focus`.
- États présents : survol, focus, désactivé (opacité 0,4), vide (`.empty`), erreur (`.error`, message en clair, liseré `--git-deleted`), statut en pastilles (`.pill`, point `--activity-green` ou `--activity-orange`).
- Tableaux denses : lignes fines, en-tête 11 px discret, défilement horizontal dans `.scroll`, 20 lignes d'aperçu puis « N lignes de plus ».
- Contraste : texte courant en `--text-primary` ou `--text-secondary`. `--text-muted` seulement pour les libellés et en-têtes. Le bouton plein (`--text-inverse` sur `--focus-blue`) mesure 3,9:1 sur one-light (sous AA 4,5) et 5,4:1 sur dark-cold : libellé court seulement, jamais de texte long.
- Responsive : la page tient à 375, 834 et 1280 px de large, sans défilement horizontal de la page (le panneau se redimensionne sur le canvas).

Le cadre (nom du panneau, origine « Panneau perso : <id> ») est dessiné par Cate au-dessus de la page : ne le recrée pas et n'imite pas l'interface de Cate.

## Limites du jalon 1

- Aucun accès aux fichiers du workspace, aucun message entre panneaux, aucune tâche déclarée : voir le tableau du manifeste.
- Un calcul sensible (fusion, dates Excel, types de cellules) affiche toujours son décompte pour être vérifié.

## Partage

Un panneau se partage en copiant son dossier (ou un dépôt git) dans `~/.cate/panneaux/` de l'autre personne. Avant : aucun secret, aucun chemin absolu dans le dossier. L'installation guidée (`cate app install`) et l'accord à chaque mise à jour arrivent au jalon 4.
