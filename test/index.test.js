const test = require('brittle')
const path = require('path')
const fs = require('fs')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Localdrive = require('localdrive')
const createTestnet = require('@hyperswarm/testnet')
const PearCI = require('../index.js')

test('create PearCI instance', async (t) => {
  const target = await setupTarget(t)
  const bootstrap = await setupTestnet(t)

  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(target, 'snapshot.json')
  const storage = await t.tmp()
  const dryRun = false

  const pearCI = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, { bootstrap })
  await pearCI.ready()

  t.is(pearCI.store.primaryKey.toString('hex'), primaryKey.toString('hex'))
  t.not(pearCI.swarm, null)

  await pearCI.close()
})

test('primary-key and name', async (t) => {
  const target = await setupTarget(t)
  const bootstrap = await setupTestnet(t)

  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(target, 'snapshot.json')
  const storage = await t.tmp()
  const dryRun = false

  const pearCI1 = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, { bootstrap })
  await pearCI1.ready()
  await pearCI1.close()

  const pearCI2 = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, { bootstrap })
  await pearCI2.ready()
  await pearCI2.close()

  t.is(pearCI1.drive.db.core.id, pearCI2.drive.db.core.id)
  t.is(pearCI1.drive.blobs.core.id, pearCI2.drive.blobs.core.id)
})

test('basic stage', async (t) => {
  t.plan(5)
  const target = await setupTarget(t)
  const bootstrap = await setupTestnet(t)

  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(target, 'snapshot.json')
  const storage = await t.tmp()
  const dryRun = false

  const pearCI = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, { bootstrap })
  await pearCI.ready()

  pearCI.on('diff', (diff) => {
    t.ok(diff)
  })

  const mirror = await setupMirror(t, bootstrap, pearCI.drive.key, pearCI.drive.blobs.core.key)
  await pearCI.stage()

  const snapshotResult = JSON.parse((await fs.promises.readFile(snapshot)).toString())

  t.ok(snapshotResult.some((e) => e.key === pearCI.drive.db.core.id))
  t.ok(snapshotResult.some((e) => e.key === pearCI.drive.blobs.core.id))
  t.ok(
    mirror.db.contiguousLength ===
      snapshotResult.find((e) => e.key === pearCI.drive.db.core.id).length
  )
  t.ok(
    mirror.blobs.contiguousLength ===
      snapshotResult.find((e) => e.key === pearCI.drive.blobs.core.id).length
  )
})

test('double stage', async (t) => {
  t.plan(5)
  const targetA = await setupTarget(t, 'targetA')
  const targetB = await setupTarget(t, 'targetB')
  const bootstrap = await setupTestnet(t)

  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(await t.tmp(), 'snapshot.json')
  const storageA = await t.tmp()
  const storageB = await t.tmp()
  const dryRun = false

  const pearCI = new PearCI(primaryKey, name, snapshot, targetA, storageA, dryRun, { bootstrap })
  await pearCI.ready()

  pearCI.on('diff', (diff) => {
    t.ok(diff)
  })

  const mirror = await setupMirror(t, bootstrap, pearCI.drive.key, pearCI.drive.blobs.core.key)

  await pearCI.stage()
  const firstStageSnapshot = JSON.parse((await fs.promises.readFile(snapshot)).toString())

  const pearCINext = new PearCI(primaryKey, name, snapshot, targetB, storageB, dryRun, {
    bootstrap
  })

  pearCINext.on('diff', (diff) => {
    t.ok(diff)
  })

  await pearCINext.stage()
  const secondStageSnapshot = JSON.parse((await fs.promises.readFile(snapshot)).toString())

  t.ok(
    firstStageSnapshot[0].key === secondStageSnapshot[0].key &&
      firstStageSnapshot[0].length < secondStageSnapshot[0].length
  )
  t.ok(
    firstStageSnapshot[1].key === secondStageSnapshot[1].key &&
      firstStageSnapshot[1].length < secondStageSnapshot[1].length
  )
  t.is(firstStageSnapshot.length, secondStageSnapshot.length)
})

test('snapshot.json length error', async (t) => {
  t.plan(1)

  const targetA = await setupTarget(t, 'targetA')
  const targetB = await setupTarget(t, 'targetB')
  const bootstrap = await setupTestnet(t)
  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(await t.tmp(), 'snapshot.json')
  const storageA = await t.tmp()
  const storageB = await t.tmp()
  const dryRun = false

  const pearCI = new PearCI(primaryKey, name, snapshot, targetA, storageA, dryRun, { bootstrap })
  await pearCI.ready()
  await setupMirror(t, bootstrap, pearCI.drive.key, pearCI.drive.blobs.core.key)
  await pearCI.stage()
  await pearCI.close()

  const snapshotResult = JSON.parse(await fs.promises.readFile(snapshot))
  const outdatedSnapshot = path.join(await t.tmp(), 'outdated-snapshot.json')
  const modifiedSnapshot = snapshotResult.map((item) => ({ ...item, length: item.length - 1 }))
  await fs.promises.writeFile(outdatedSnapshot, JSON.stringify(modifiedSnapshot))

  const faultyPearCI = new PearCI(primaryKey, name, outdatedSnapshot, targetB, storageB, dryRun, {
    bootstrap
  })

  await t.exception(() => faultyPearCI.ready())
})

test('dry-run', async (t) => {
  t.plan(3)
  const target = await setupTarget(t)
  const bootstrap = await setupTestnet(t)

  const primaryKey = Buffer.alloc(32)
  const name = 'pear-ci-test'
  const snapshot = path.join(target, 'snapshot.json')
  const storage = await t.tmp()
  const dryRun = true

  const pearCI = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, { bootstrap })
  await pearCI.ready()

  pearCI.on('diff', (diff) => {
    t.ok(diff)
  })

  const mirror = await setupMirror(t, bootstrap, pearCI.drive.key, pearCI.drive.blobs.core.key)
  await pearCI.stage()

  const snapshotResult = JSON.parse((await fs.promises.readFile(snapshot)).toString())

  t.is(snapshotResult[0].length, 0)
  t.is(snapshotResult[1].length, 0)
})

async function setupTarget(t, content = 'hello pear-ci') {
  const tmp = await t.tmp()
  const local = new Localdrive(tmp)
  await local.ready()
  await local.put('/file', Buffer.from(content))
  t.teardown(() => local.close())
  return tmp
}

async function setupTestnet(t) {
  const testnet = await createTestnet(3)
  t.teardown(() => testnet.destroy())
  const bootstrap = testnet.bootstrap
  return bootstrap
}

async function setupMirror(t, bootstrap, dbKey, blobsKey) {
  const store = new Corestore(await t.tmp())
  await store.ready()
  const swarm = new Hyperswarm({ bootstrap })
  swarm.on('connection', (conn) => {
    store.replicate(conn)
  })

  const db = store.get({ key: dbKey })
  await db.ready()

  const blobs = store.get({ key: blobsKey })
  await blobs.ready()

  swarm.join(db.discoveryKey)

  db.download()
  blobs.download()

  t.teardown(() => swarm.destroy())
  t.teardown(() => db.close())
  t.teardown(() => blobs.close())
  t.teardown(() => store.close())

  return { swarm, store, db, blobs }
}
