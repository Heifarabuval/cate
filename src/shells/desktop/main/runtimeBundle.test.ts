import { expect, it } from 'vitest'
import { runtimeBundleOverride } from './runtimeBundle'

it('is a development override only when CATE_RUNTIME_BUNDLE names a bundle', () => {
  expect(runtimeBundleOverride({ CATE_RUNTIME_BUNDLE: 'dist-runtime/runtime.cjs' })).toBe(true)
  expect(runtimeBundleOverride({ CATE_RUNTIME_BUNDLE: '' })).toBe(false)
  expect(runtimeBundleOverride({})).toBe(false)
})
