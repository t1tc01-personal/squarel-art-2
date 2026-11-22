import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const schemaAlias = {
  '@squarel/integration-schema': resolve(__dirname, '../integrations/schema/integration.schema.ts'),
}

export default defineConfig({
  main: { resolve: { alias: schemaAlias } },
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
