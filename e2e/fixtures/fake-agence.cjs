/* global process, require, __dirname, URL, URLSearchParams */
/* eslint-disable @typescript-eslint/no-require-imports */
// `agence` stand-in for the agence panel's e2e: only `agence watch
// --token-stdin`, the regisseur the panel starts. It serves the form POSTs of
// agence.py's `click()` for drafts (same checks, same wording, same
// `{code, message}` answers) over the state file the test writes, and sends
// through the `gh` on its PATH, which must be the fake one (`fake-gh.cjs`).
//
// Beside this file: `mode` ("old" = a CLI too old for `--token-stdin`) and
// `refuse.json` ({draftId: message}: that draft's next click is refused with
// a 409 and this message, like a click racing another).
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' } }
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex')
const log = (line) => process.stderr.write(`agence : ${line}\n`)

if (process.argv[2] !== 'watch') { log('fake agence: only watch'); process.exit(2) }
if (read(path.join(__dirname, 'mode')) === 'old' || !process.argv.includes('--token-stdin')) {
  log('error: unrecognized arguments: --token-stdin')
  process.exit(2)
}

const dir = path.join(process.env.AGENCE_ROOT || process.cwd(), '.cate', 'tmp', 'agence')
const stateFile = path.join(dir, 'state.json')
const load = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const save = (state) => {
  const tmp = path.join(dir, `tmp-state-${process.pid}`)
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1))
  fs.renameSync(tmp, stateFile)
}

let token = ''
process.stdin.setEncoding('utf8')
let first = true
process.stdin.on('data', (chunk) => {
  if (!first) return
  first = false
  token = chunk.split('\n')[0].trim()
  start()
})
// The end of stdin means the daemon died: stop with it.
process.stdin.on('end', () => process.exit(0))

/** One draft click: `click()` of agence.py. Returns [code, message]. */
function click(pathname, form) {
  const match = /^\/draft\/(d\d+)\/(send|drop|edit)$/.exec(pathname)
  if (!match) return [404, 'Introuvable']
  const [, id, action] = match
  const refuse = (() => { try { return JSON.parse(read(path.join(__dirname, 'refuse.json'))) } catch { return {} } })()
  if (refuse[id]) return [409, refuse[id]]
  const state = load()
  const draft = state.drafts.find((d) => d.id === id)
  if (!draft) return [409, `${id} introuvable`]
  const need = state.needs.find((n) => n.id === draft.needId)
  if (action === 'edit') return [303, `/draft/${id}`]
  if (draft.statut !== 'à valider') return [409, `Ce brouillon est déjà « ${draft.statut} ».`]
  if (need.status !== 'open') return [409, "Ce brouillon n'est plus attendu (besoin clos)."]
  if (action === 'drop') {
    draft.statut = 'abandonné'
    need.status = 'dropped'
    save(state)
    return [303, '/']
  }
  const texte = fs.readFileSync(path.join(dir, 'drafts', `${id}.md`), 'utf8').trim()
  if ((form.get('h') || '') !== sha(texte)) return [409, 'Le texte a changé depuis son affichage : recharge la page, relis, puis Envoyer.']
  Object.assign(draft, { statut: 'envoyer', texte, hash: sha(texte) })
  const [kind, rest] = [draft.cible.split(':', 1)[0], draft.cible.slice(draft.cible.indexOf(':') + 1)]
  if (kind === 'slack' || kind === 'mail') { save(state); return [303, '/'] }
  // Never the real GitHub: the gh on PATH must be the fake one.
  const resolved = spawnSync('/bin/sh', ['-c', 'command -v gh'], { encoding: 'utf8' }).stdout.trim()
  if (path.basename(path.dirname(resolved)) !== 'fake-bin') {
    draft.statut = 'à valider'
    save(state)
    return [409, `Envoi refusé par GitHub : gh n'est pas le faux gh (${resolved || 'absent'})`]
  }
  const title = draft.titre || texte.split('\n')[0].slice(0, 80)
  let args
  if (kind === 'issue') args = ['issue', 'create', '-R', rest, '--title', title, '--body-file', '-']
  else if (kind === 'pr') { const [repo, base, head] = rest.split(':'); args = ['pr', 'create', '-R', repo, '--base', base, '--head', head, '--title', title, '--body-file', '-'] }
  else { const [repo, num] = rest.split('#'); args = ['issue', 'comment', num, '-R', repo, '--body-file', '-'] }
  const result = spawnSync('gh', args, { input: `${texte}\n`, encoding: 'utf8' })
  if (result.status !== 0) {
    draft.statut = 'à valider'
    Object.assign(draft, { texte: null, hash: null })
    save(state)
    return [409, `Envoi refusé par GitHub : ${(result.stderr || result.stdout).trim()}`]
  }
  const url = result.stdout.trim().split('\n').pop() || ''
  Object.assign(draft, { statut: 'envoyé', url })
  Object.assign(need, { status: 'done', evidence: url })
  save(state)
  return [303, '/']
}

function start() {
  let port = null
  try { port = load().port } catch { /* no state yet */ }
  if (!port) { log("pas de port : l'orchestrateur lance d'abord « agence boot »"); process.exit(1) }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const form = new URLSearchParams(body)
      let code
      let message
      if (form.get('token') !== token) [code, message] = [403, 'Jeton invalide']
      else {
        try { [code, message] = click(new URL(req.url, 'http://x').pathname, form) } catch (error) { [code, message] = [409, String(error)] }
      }
      res.writeHead(code === 303 ? 200 : code, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code, message }))
    })
  })
  server.on('error', (error) => { log(`régisseur déjà actif sur ${port} (${error.message})`); process.exit(2) })
  server.listen(port, '127.0.0.1', () => log(`régisseur sur http://127.0.0.1:${port}/ (Ctrl-C pour arrêter)`))
  process.on('SIGTERM', () => process.exit(0))
}
