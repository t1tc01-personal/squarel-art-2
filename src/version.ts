import { readFileSync } from 'node:fs'

/** The one Squarel version number: package.json's `version` (bridge, MCP server and presence all report it). */
export const SQUAREL_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
