// Child process used by store.test.ts: performs N locked read-modify-write commits.
import { celKey } from '../../src/core/codec.ts'
import { Store } from '../../src/store/store.ts'

const [root, slug, offset, count] = process.argv.slice(2)
const store = new Store(root)
for (let i = 0; i < Number(count); i++) {
  await store.withHead(slug, 'cli', `worker ${offset} #${i}`, (doc) => {
    doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][Number(offset) + i] = 1
  })
}
