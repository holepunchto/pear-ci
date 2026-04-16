# pear-ci

A CI staging tool for [Hyperdrive](https://github.com/holepunchto/hyperdrive). Mirrors a local directory into a Hyperdrive, replicates it over [Hyperswarm](https://github.com/holepunchto/hyperswarm), and writes a snapshot of core lengths so subsequent runs only sync what changed.

## Install

```
npm install pear-ci
```

## Usage

```js
const PearCI = require('pear-ci')

const primaryKey = Buffer.from('<32-byte-hex-key>', 'hex')

const ci = new PearCI(
  primaryKey, // deterministic key for the corestore
  'my-app', // drive namespace name
  './snapshot.json', // path to read/write the snapshot
  './dist', // local directory to stage
  './storage', // corestore storage path
  false // dryRun
)

ci.on('diff', (diff) => console.log('changed:', diff))
ci.on('synced', () => console.log('all peers caught up'))

await ci.stage()
```

## API

### `const ci = new PearCI(primaryKey, name, snapshot, target, storage, dryRun, [opts])`

Creates a new PearCI instance. Does not open any resources until `ready()` or `stage()` is called.

| Argument         | Type      | Description                                                                                             |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `primaryKey`     | `Buffer`  | 32-byte key passed to `Corestore`. Determines the identity of the drive across runs.                    |
| `name`           | `string`  | Namespace name used to derive the Hyperdrive from the store.                                            |
| `snapshot`       | `string`  | File path for the JSON snapshot. Read on open to pre-seed cores; written on close with updated lengths. |
| `target`         | `string`  | Path to the local directory to mirror into the drive.                                                   |
| `storage`        | `string`  | Path for Corestore storage.                                                                             |
| `dryRun`         | `boolean` | When `true`, diffs are computed and emitted but nothing is written to the drive.                        |
| `opts.bootstrap` | `array`   | Optional Hyperswarm bootstrap nodes. Useful for testing with `@hyperswarm/testnet`.                     |

### `await ci.stage()`

Opens the instance (if not already open), mirrors `target` into the drive, waits for all connected peers to replicate the new blocks, emits `synced`, then closes.

Calling `stage()` is the primary entry point — you do not need to call `ready()` manually.

### `await ci.ready()`

Opens the corestore, swarm, and drive. Joins all known discovery keys. If a snapshot exists, blocks until all cores have downloaded to their recorded lengths before resolving.

### `await ci.close()`

Writes the snapshot, then tears down the swarm, local drive, Hyperdrive, and corestore.

### Events

#### `ci.on('diff', (diff) => {})`

Emitted for each file that differs between the local directory and the drive. `diff` is the object produced by [mirror-drive](https://github.com/holepunchto/mirror-drive).

#### `ci.on('synced', () => {})`

Emitted once after staging completes and all peers have acknowledged the new blocks, just before the instance closes.

## Snapshot file

The snapshot is a JSON array written to `snapshot` on every close. Each entry records a core's public key, its length at close time, and any namespace alias information. On the next open, PearCI reads this file and waits until each core has downloaded to at least its recorded length before resolving `ready()`. This ensures a CI run never races ahead of peers that are still catching up from a previous stage.

```json
[
  {
    "key": "abc123...",
    "length": 42,
    "namespace": "deadbeef...",
    "name": "my-app/blobs"
  }
]
```

If the file does not exist or cannot be parsed, PearCI starts fresh with an empty store.

## How it works

1. On `_open`, any cores recorded in the snapshot are pre-initialised in the store so Hyperswarm can announce their discovery keys immediately.
2. The Hyperdrive is opened under a namespaced session derived from `primaryKey` + `name`, making its core IDs stable and reproducible across machines given the same inputs.
3. `stage()` runs [mirror-drive](https://github.com/holepunchto/mirror-drive) with deduplication and batching enabled, emitting a `diff` event for every changed entry.
4. After mirroring, `stage()` polls until `remoteContiguousLength` catches up to the local length on both the db and blobs cores, ensuring peers have fully replicated before the process exits.
5. On `_close`, all core lengths and namespace aliases are serialised back to the snapshot file.

## License

Apache-2.0
