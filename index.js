const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Localdrive = require('localdrive')
const Hyperdrive = require('hyperdrive')
const Mirror = require('mirror-drive')
const ReadyResouce = require('ready-resource')
const fs = require('fs')
const path = require('path')

class PearCI extends ReadyResouce {
  constructor(primaryKey, name, snapshot, target, storage, dryRun, opts = {}) {
    super()
    this.primaryKey = primaryKey
    this.name = name
    this.snapshot = snapshot
    this.target = target
    this.storage = storage
    this.dryRun = dryRun
    this.bootstrap = opts.bootstrap
    this.store = null
    this.swarm = null
    this.drive = null
    this.local = null
  }

  async _open() {
    await fs.promises.mkdir(path.dirname(this.snapshot), { recursive: true })
    const json = await parseJSON(this.snapshot)

    this.store = new Corestore(this.storage, {
      primaryKey: this.primaryKey,
      unsafe: true
    })
    await this.store.ready()

    this.swarm = new Hyperswarm({ bootstrap: this.bootstrap })
    this.swarm.on('connection', (c) => this.store.replicate(c))

    for (const { key, namespace, name } of json) {
      if (namespace) {
        const ns = this.store.session({ namespace: Buffer.from(namespace, 'hex') })
        const core = ns.get({ name })
        await core.ready()
        await core.close()
        await ns.close()
      } else {
        const core = this.store.get(key)
        await core.ready()
        await core.close()
      }
    }

    this.drive = new Hyperdrive(this.store.namespace(this.name))
    await this.drive.ready()

    for await (const discoveryKey of this.store.list()) {
      this.swarm.join(discoveryKey, { client: true, server: true })
    }

    for (const { key, length } of json) {
      const core = this.store.get(key)
      await core.ready()

      this.emit('syncing', { key, length })

      while (core.length < length) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      if (core.length > length) {
        const coreLength = core.length
        await this._close()
        throw Error(`Core ${core.id} length (${coreLength}) is higher than length in snapshot.json`)
      }

      await core.close()
    }
  }

  async stage() {
    await this.ready()

    this.local = new Localdrive(this.target)

    this.drive.db.core.download() // prefetch metadata

    const mirror = new Mirror(this.local, this.drive, {
      dedup: true,
      batch: true,
      dryRun: this.dryRun
    })

    for await (const diff of mirror) {
      this.emit('diff', diff)
    }

    this.emit('mirrored')

    while (this.drive.db.core.remoteContiguousLength < this.drive.db.core.length) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    while (this.drive.blobs.core.remoteContiguousLength < this.drive.blobs.core.length) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    this.emit('synced')

    await this._updateSnapshot()
    await this.close()
  }

  async _updateSnapshot() {
    await fs.promises.mkdir(path.dirname(this.snapshot), { recursive: true })

    const json = []
    const all = new Map()

    for await (const discoveryKey of this.store.list()) {
      const core = this.store.get({ discoveryKey })
      await core.ready()

      const entry = {
        key: core.id,
        length: core.length,
        namespace: null,
        name: null
      }

      all.set(discoveryKey.toString('hex'), entry)
      json.push(entry)

      await core.close()
    }

    for await (const { discoveryKey, alias } of this.store.storage.createAliasStream()) {
      const entry = all.get(discoveryKey.toString('hex'))
      if (entry) {
        entry.namespace = alias.namespace.toString('hex')
        entry.name = alias.name
      }
    }

    await fs.promises.writeFile(this.snapshot, JSON.stringify(json, null, 2) + '\n')
  }

  async _close() {
    await this.swarm?.destroy()
    await this.local?.close()
    await this.drive?.close()
    await this.store?.close()
  }
}

async function parseJSON(filename) {
  try {
    return JSON.parse(await fs.promises.readFile(filename, 'utf-8'))
  } catch {
    return []
  }
}

module.exports = PearCI
