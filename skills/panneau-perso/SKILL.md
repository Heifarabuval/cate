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
- tout le reste (`app.js`, `style.css`, bibliothèques, données d'essai) dans le même dossier, en chemins relatifs.

Manifeste : `id`, `name`, `version`, `description`, `author`, `icon` (nom lucide), `entry`, `size` (`width`, `height`), `permissions` (`files.read` et `files.write` en globs relatifs à la racine du workspace, `network` en liste d'hôtes, `links.receive`, `links.emit`), `inputs` optionnel (libellés des champs). C'est le format du futur type `app`.

**Les permissions sont déclaratives. Rien ne les applique en mode page** : la page tourne comme une page web ordinaire (réseau ouvert, même origine que les autres pages du serveur de fichiers). Elles disent ce que le panneau doit faire. Respecte-les dans ton code : `network: []` veut dire aucun appel sortant.

## Créer

1. Copie `gabarit/` dans `.cate/panels/<id>/`, remplis le manifeste, écris la page.
2. Une bibliothèque (SheetJS, Chart.js...) est un fichier `.js` copié dans le dossier, récupéré **une seule fois, à la création**, version fixée dans l'URL, puis chargé par `<script src="lib.min.js">`. Aucun appel réseau à l'exécution, aucun CDN dans le HTML. Exemple SheetJS :
   `curl -fsSL -o .cate/panels/<id>/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`
   Ne commite pas de bibliothèque minifiée dans le dépôt de Cate. Dans un projet d'équipe, elle suit le panneau.
3. Données d'essai : petits fichiers dans le dossier du panneau. La page les charge par chemin relatif (`fetch('a.xlsx')`) ou par `<input type="file">`.
4. Ouvre la page dans un panneau navigateur :
   ```bash
   cate panel create browser .cate/panels/<id>/index.html
   ```
   Le chemin est servi par le serveur de fichiers du runtime (HTTP local, un jeton par dossier, la page n'atteint que son dossier). Workspace non approuvé : le HTML est servi en texte et la page ne s'affiche pas. Demande l'approbation à la personne.
5. Relie le panneau à l'agent créateur (toi) pour qu'il le pilote et lise ce qu'il affiche :
   ```bash
   cate panel link <ton-id> <id-du-panneau> --kind context
   ```
6. Vérifie avec `cate browser snapshot --panel <id-du-panneau>` : le contenu attendu est dans l'arbre. Fais afficher à la page un décompte (lignes lues, lignes sans correspondance) pour contrôler un calcul sans deviner. Après une retouche : `cate browser reload --panel <id-du-panneau>`.

## Limites du mode page

- **Aucune écriture dans le workspace** : le serveur est en lecture seule (GET). Un export passe par un téléchargement (`<a download>` sur un `Blob`) ; l'agent déplace ensuite le fichier téléchargé si besoin (`cate browser downloads`).
- Pas de messages typés entre panneaux : un lien passe par l'agent, qui lit la page (`snapshot`) et la pilote (`fill`, `click`). Lent et fragile : réserver aux petits outils.
- Pas d'accord utilisateur, pas d'isolation d'origine par panneau.
- Un calcul sensible (fusion, dates Excel, types de cellules) affiche toujours son décompte pour être vérifié.

## Partage

Panneau d'équipe : le dossier est commité sous `<root>/.cate/panels/<id>/`. `.cate/.gitignore` ignore tout sauf `skills.json` : ajoute `!panels/` et `!panels/**` dans le projet concerné, avec l'accord de la personne. Dans le dépôt Cate lui-même, le `.gitignore` racine ignore aussi `.cate/`.
