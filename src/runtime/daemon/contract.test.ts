import { expect, it } from 'vitest'
import { agenceLauncher, buildVersion, checksumUrl, installDirFromExecPath, installLayout, isBuildId, parseDaemonArgv, releaseUrl, runtimeInstallDir, runtimeTarget, serveArgv } from './contract'

it('round-trips the serve command line', () => {
  const args = { root: '/w', detach: true }
  expect(serveArgv(args)).toEqual(['serve', '/w', '--detach'])
  expect(parseDaemonArgv(serveArgv(args))).toEqual({ command: 'serve', args })
  expect(parseDaemonArgv(['serve', '/w'])).toEqual({ command: 'serve', args: { root: '/w', detach: false } })
  expect(parseDaemonArgv(['serve']).command).toBe('error')
  expect(parseDaemonArgv(['serve', '/w', '--network', 'sameNetwork']).command).toBe('error')
  expect(parseDaemonArgv(['serve', '/w', '--bogus']).command).toBe('error')
  expect(parseDaemonArgv(['--root', '/w']).command).toBe('error')
  expect(parseDaemonArgv(['bridge', '/w'])).toEqual({ command: 'bridge', root: '/w' })
  expect(parseDaemonArgv(['bridge']).command).toBe('error')
  expect(parseDaemonArgv(['bridge', '/w', '/x']).command).toBe('error')
})

it('lays out an install the same way on every platform', () => {
  const posix = installLayout(runtimeInstallDir('/home/u/.cate', '2.1.0', 'linux'), 'linux')
  expect(posix.node).toBe('/home/u/.cate/runtime/2.1.0/runtime/bin/node')
  expect(posix.bundle).toBe('/home/u/.cate/runtime/2.1.0/runtime.cjs')
  expect(posix.cateBin).toBe('/home/u/.cate/runtime/2.1.0/cate/bin')
  expect(posix.agence).toBe('/home/u/.cate/runtime/2.1.0/agence/agence')
  expect(installLayout('/opt/cate-install', 'darwin').agence).toBe('/opt/cate-install/agence/agence')
  const win = installLayout(runtimeInstallDir('C:\\Users\\u\\.cate', '2.1.0', 'win32'), 'win32')
  expect(win.node).toBe('C:\\Users\\u\\.cate\\runtime\\2.1.0\\runtime\\bin\\node.exe')
  expect(installDirFromExecPath(posix.node, 'linux')).toBe('/home/u/.cate/runtime/2.1.0')
  expect(installDirFromExecPath(win.node, 'win32')).toBe('C:\\Users\\u\\.cate\\runtime\\2.1.0')
})

it('runs the agence launcher from the install, or from the checkout for a bare bundle', () => {
  const install = '/home/u/.cate/runtime/2.1.0'
  expect(agenceLauncher(install, undefined, 'linux')).toBe(`${install}/agence/agence`)
  // `CATE_RUNTIME_BUNDLE=<checkout>/dist-runtime/runtime.cjs`: no install around the bundle.
  expect(agenceLauncher('/nvm/versions/node', '/w/cate/dist-runtime/runtime.cjs', 'linux')).toBe('/w/cate/tools/agence/agence')
})

it('names release tarballs per target', () => {
  expect(runtimeTarget('darwin', 'arm64')).toBe('darwin-arm64')
  expect(runtimeTarget('win32', 'arm64')).toBeNull()
  expect(releaseUrl('2.1.0', 'linux-x64')).toBe(
    'https://github.com/0-AI-UG/cate/releases/download/v2.1.0/cate-runtime-2.1.0-linux-x64.tgz',
  )
  expect(checksumUrl('2.1.0', 'linux-x64')).toBe(`${releaseUrl('2.1.0', 'linux-x64')}.sha256`)
})

it('reads build ids', () => {
  expect(isBuildId('2.1.0+0123456789ab')).toBe(true)
  expect(isBuildId('2.1.0-beta.1+0123456789ab')).toBe(true)
  expect(isBuildId('2.1.0')).toBe(false)
  expect(isBuildId('2.1.0+xyz')).toBe(false)
  expect(isBuildId('../x+0123456789ab')).toBe(false)
  expect(buildVersion('2.1.0-beta.1+0123456789ab')).toBe('2.1.0-beta.1')
})
