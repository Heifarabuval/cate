/* global process, require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
// `gh` stand-in for the agence e2e: records each call ({args, stdin}) in
// `gh.log` beside this file and answers like the commands the regisseur sends
// with. It never reaches GitHub. A `gh-fail` file beside it makes every call
// fail with its content on stderr.
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
let stdin = ''
if (args.includes('--body-file')) { try { stdin = fs.readFileSync(0, 'utf8') } catch { /* no stdin */ } }
fs.appendFileSync(path.join(__dirname, 'gh.log'), `${JSON.stringify({ args, stdin })}\n`)
let failure = ''
try { failure = fs.readFileSync(path.join(__dirname, 'gh-fail'), 'utf8').trim() } catch { /* works */ }
if (failure) { process.stderr.write(`${failure}\n`); process.exit(1) }
const repo = args[args.indexOf('-R') + 1] ?? 'acme/site'
if (args[0] === 'issue' && args[1] === 'create') console.log(`https://github.com/${repo}/issues/42`)
else if (args[0] === 'pr' && args[1] === 'create') console.log(`https://github.com/${repo}/pull/7`)
else if (args[0] === 'issue' && args[1] === 'comment') console.log(`https://github.com/${repo}/issues/${args[2]}#issuecomment-1`)
else { process.stderr.write(`fake gh: unsupported ${args.join(' ')}\n`); process.exit(1) }
