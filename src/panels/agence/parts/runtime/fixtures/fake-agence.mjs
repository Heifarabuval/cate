/* global process, URLSearchParams */
// A stand-in for `agence watch --token-stdin` (common/tools/agence.py): takes
// the token on the first line of stdin, serves the regisseur's JSON replies on
// FAKE_AGENCE_PORT, stops at SIGTERM or at the end of stdin. FAKE_AGENCE_MODE:
//   (none)          runs, logs "régisseur sur ..." on stderr when it listens
//   busy            the port is taken: exits 2 like cmd_watch
//   unknown-option  an older CLI without --token-stdin: argparse error, exit 2
//   settings        runs, and complains about the workspace CLI settings
//   stubborn        runs, and ignores SIGTERM (only SIGKILL ends it)
// FAKE_AGENCE_LOG gets one JSON line per event.
import { appendFileSync } from 'node:fs'
import http from 'node:http'
import readline from 'node:readline'

const port = Number(process.env.FAKE_AGENCE_PORT)
const mode = process.env.FAKE_AGENCE_MODE ?? ''
const log = (event) => appendFileSync(process.env.FAKE_AGENCE_LOG, `${JSON.stringify({ pid: process.pid, ...event })}\n`)

if (mode === 'unknown-option') {
  process.stderr.write('usage: agence watch [-h]\nagence watch: error: unrecognized arguments: --token-stdin\n')
  process.exit(2)
}
if (mode === 'busy') {
  process.stderr.write(`agence: régisseur déjà actif sur ${port} (Address already in use)\n`)
  process.exit(2)
}

const lines = readline.createInterface({ input: process.stdin })
let token = null
lines.once('line', (line) => {
  token = line.trim()
  log({
    event: 'start',
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    root: process.env.AGENCE_ROOT,
    cateToken: process.env.CATE_TOKEN,
    token,
    tokenInEnv: Object.values(process.env).some((value) => value.includes(token)),
  })
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const form = new URLSearchParams(body)
      const reply = (status, code, message) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code, message }))
      }
      if (form.get('token') !== token) return reply(403, 403, 'Jeton invalide')
      log({ event: 'post', method: req.method, url: req.url, accept: req.headers.accept, form: Object.fromEntries(form) })
      if (form.get('h') === 'ancien') return reply(409, 409, 'texte a changé')
      reply(200, 200, 'ok')
    })
  })
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`régisseur sur http://127.0.0.1:${port}/ (Ctrl-C pour arrêter)\n`)
    if (mode === 'settings') {
      process.stderr.write('Cate refuse la saisie dans le terminal du régisseur ; réglages CLI du workspace à activer dans Cate : panneaux (cliPanelReadEnabled)\n')
    }
  })
  // The end of stdin: the parent died.
  process.stdin.on('end', () => { log({ event: 'stdin-end' }); server.close(); process.exit(0) })
})
process.on('SIGTERM', () => { log({ event: 'sigterm' }); if (mode !== 'stubborn') process.exit(0) })
