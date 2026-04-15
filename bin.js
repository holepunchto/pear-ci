#!/usr/bin/env node
const { command, argv } = require('paparam')
const pkg = require('./package')
const PearCI = require('.')

const cmd = command(pkg.name, pkg.command, async function (cmd) {
  if (cmd.flags.version) return console.log(`v${pkg.version}`)

  let { primaryKey, name, snapshot, target, storage, dryRun } = cmd.flags

  if (!primaryKey) throw new Error('--primary-key flag is required')
  if (!name) throw new Error('--name flag is required')
  if (!snapshot) throw new Error('--snapshot flag is required')
  if (!target) throw new Error('--target flag is required')
  if (!storage) throw new Error('--storage flag is required')

  primaryKey = Buffer.from(primaryKey, 'hex')

  const pearCI = new PearCI(primaryKey, name, snapshot, target, storage, dryRun)

  pearCI.on('connection', () => {
    console.log('Peer connected')
  })

  pearCI.on('diff', (diff) => {
    console.log(diff)
  })

  pearCI.on('synced', () => {
    console.log('all remote peers synced')
  })

  await pearCI.ready()
  console.log('starting stage for key ', pearCI.drive.core.id)

  await pearCI.stage()
})

cmd.parse(argv().length === 0 ? ['--help'] : argv())
