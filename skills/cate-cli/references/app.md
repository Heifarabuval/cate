# Custom panels: cate app

Custom panels are folders of `~/.cate/panneaux/` (the `panneau-perso` skill
writes them). `cate app` shares them. It never installs one: installing is a
click of the user on the import card in Cate, and no command reaches it.

Permission: Settings → CLI → Custom panels (Read for `list` and `imports`,
Control for `export` and `import`).

```bash
cate app list                                          # the custom panels and their state
cate app export <id> --out <id>.cate-panneau          # write a package; the last line is the fingerprint
cate app import <package or folder> --empreinte <start>  # put it on hold, answers the import id and the fingerprint
cate app imports                                       # the imports waiting for a click (10 at most, 24 h each)
```

- `export` reads the folder without changing it, leaves out `.git/` and
  `node_modules/` and says so, and refuses a symbolic link, a `.env`, a
  private key, a known token (`ghp_`, `sk-`, `AKIA`) or an absolute path of
  the machine (`/Users/`, `/home/`), naming the file and the line, never the
  value. Passing this check does not prove there is no secret.
- `--out` is a path on the machine that runs the workspace, outside the
  panel's folder.
- Give the fingerprint to the recipient by another channel than the package.
  `--empreinte` (8 hex characters at least) refuses a package whose
  fingerprint does not start with it, before anything is put on hold.
- `import` checks the source and copies it into the workspace's quarantine,
  never into the panels folder. Tell the user to open Cate and read the
  import card: Install copies and allows the panel, Cancel drops it.
- Importing a panel id that already exists replaces the pending import of
  that id; the card shows the files added, changed and removed.
