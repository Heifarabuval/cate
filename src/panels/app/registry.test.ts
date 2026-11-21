// SC-003: installing a panel is a human's click in a client (`apps.acceptImport`),
// never a `cate` method an agent in a terminal can call. Any new `app` method
// of the `cate` API must be added here on purpose, after checking that its
// handler writes nothing into the panels folder.

import { expect, it } from 'vitest'
import { CATE_API } from '../api'

/** The only `app` methods of the `cate` API (spec 007 FR-019); none writes into the panels folder. */
const APP_METHODS = ['export', 'import', 'imports', 'list']

const methods = () => CATE_API.flatMap((namespace) => Object.values(namespace.methods))

it('no cate API method accepts or installs an import', () => {
  expect(methods().filter((method) => /accept|install/i.test(method.method)).map((method) => method.method)).toEqual([])
})

it('the app namespace holds only the methods that never write into the panels folder', () => {
  const app = methods().filter((method) => method.namespace === 'app').map((method) => method.name)
  expect(app.filter((name) => !APP_METHODS.includes(name))).toEqual([])
})
