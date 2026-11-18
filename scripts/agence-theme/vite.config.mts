import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server of the agence color harness (npm run is not wired on purpose).
const root = resolve(__dirname, '../..')
const alias = Object.fromEntries(
  ['kernel', 'runtime', 'workspace', 'services', 'client', 'panels', 'shells'].map((name) => [`@${name}`, resolve(root, `src/${name}`)]),
)

export default defineConfig({
  root,
  resolve: { alias },
  plugins: [react()],
  define: { __CATE_BUILD__: JSON.stringify('harness'), __SENTRY_DSN__: JSON.stringify('') },
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
})
