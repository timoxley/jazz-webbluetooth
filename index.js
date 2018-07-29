/* eslint-disable no-lone-blocks */
/* globals ContextMenu */

const { patch, elementOpen, elementClose, elementVoid, text } = window.IncrementalDOM

const SERVICE = {
  FUTargetSigned: 0xFE59,
  FUTargetUnSigned: 0xFE58,
  Battery: 0x180F,
  Freedrum: '0e5a1523-ede8-4b33-a751-6ce34ec47c00',
  Midi: '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
}

const CHARACTERISTIC = {
  FreedrumCharOrientation: '0e5a1525-ede8-4b33-a751-6ce34ec47c00',
  FreedrumDrumConf: '0e5a1526-ede8-4b33-a751-6ce34ec47c00',
  FreedrumVersion: '0e5a1527-ede8-4b33-a751-6ce34ec47c00',
  FreedrumStatus: '0e5a1528-ede8-4b33-a751-6ce34ec47c00',
  Battery: 0x2A19,
  BatteryLevel: '00002a19-0000-1000-8000-00805f9b34fb',
  MidiIO: '7772e5db-3868-4112-a1a9-f2669d106bf3'
}

const FreedrumCCNames = {
  command: 20,
  status: 21,
  readValue: 22,
  yPos: 23,
  batteryLevel: 24,
  zPos: 103,
  threshold: 104,
  sensitivity: 105,
  midiNoteForPad: 106,
  xAxis: 107,
  // if >0 orientation changes around the x-axis are sent as CC <x_axis_cc>
  yAxis: 108,
  zAxis: 109,
  refDrumWindowSize: 110,
  refDrumStrength: 111,
  midiNoteForPadLeftTwist: 112,
  /*
   * How accurately do we need to hit the ref drum in y-axis to get prediction of hit time? 0 means turn off this kind
   * of prediction.
   */
  predictVarianceThreshold: 113,
  /**
   * what cc to send for foot pedal change. Foot pedal cc is sent for the ref drum when y is above the pad mid y.
   */
  footPedalCC: 114,
  version: 115,
  zoneChange: 16,
  commandSaveSettings: 0
}

const FreedrumCC = Object.entries(FreedrumCCNames)
  .reduce((o, [name, number]) => Object.assign(o, { [number]: name }), {})

/**
 * Bluetooth Devices
 */

const devices = {}
const batteryLevels = {}

window.devices = devices

function updateDevice (id, update = {}) {
  devices[id] = {
    ...(devices[id] || { id }),
    ...update
  }
  render()
}

async function tryAddController () {
  try {
    const id = await addController()
    const { characteristics, device } = devices[id]

    device.addEventListener('gattserverdisconnected', () => {
      render()
    })

    const { MidiIO } = characteristics
    MidiIO.addEventListener('characteristicvaluechanged', onMidiIOEvent)
    await MidiIO.startNotifications()
    updateDevice(id, { ready: true })
    render()
  } catch (err) {
    console.error(err)
    render()
  }
}

async function addController () {
  const required = [
    SERVICE.Midi
  ]

  const optional = [
    SERVICE.Freedrum,
    SERVICE.Battery
  ]

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: required }],
    optionalServices: optional
  })

  const { id } = device
  if (devices[id] && devices[id].gatt && devices[id].gatt.connected) {
    return id
  }

  updateDevice(id, { device })

  const server = await device.gatt.connect()
  updateDevice(id, { server })
  const services = await server.getPrimaryServices()
  updateDevice(id, { services })
  const characteristics = await getCharacteristics(services)
  updateDevice(id, { characteristics })
  return id
}

async function getCharacteristics (services) {
  const characteristics = await Promise.all(services.map(s => s.getCharacteristics()))
  // map characteristics to names or uuid if not found
  return [].concat(...characteristics).reduce((o, c) => {
    c.name = Object.keys(CHARACTERISTIC).find(name => {
      return CHARACTERISTIC[name] === c.uuid
    }) || c.uuid
    o[c.name] = c
    return o
  }, {})
}

/**
 * MIDI Messages
 */

let messageID = 0

function onMidiIOEvent (event) {
  try {
    const { value, service } = event.target
    const b = []
    for (let i = 0; i < value.byteLength; i++) {
      b.push(value.getUint8(i))
    }

    const data = b.slice(-3)

    port.send(data)
    const midi = window.midimessage({ data })

    const message = {
      id: messageID++,
      deviceID: service.device.id,
      timeStamp: event.timeStamp,
      ...midi,
      noteName: window.JZZ.MIDI.percussionName(midi.key)
    }

    onMessage(message)
  } catch (err) {
    console.log(err)
  }
}

function onMessage (message) {
  updateBatteryLevel(message)
  addActivity(message)
  logMessage(message)
}

function updateBatteryLevel (message) {
  const id = message.deviceID
  const { device } = devices[id]
  if (!device.name.startsWith('FD1')) return
  // special midi cc messages for freedrum
  if (
    message.messageType === 'controlchange' &&
    message.controllerNumber === 24
  ) {
    batteryLevels[id] = message.controllerValue
    patchBatteryLevel(id)
  }
}

function logMessage (message) {
  const { messageType, deviceID: id } = message
  if (messageType === 'controlchange') {
    const name = FreedrumCC[message.controllerNumber] || message.controllerNumber
    console.debug(
      id,
      message.messageType,
      name,
      message.controllerValue,
      { message }
    )
  } else if (messageType.startsWith('note')) {
    console.debug(
      id,
      message.messageType,
      message.noteName || message.key,
      message.velocity,
      { message }
    )
  } else {
    console.debug(
      id,
      message.messageType,
      { message }
    )
  }
}

/**
 * Activity
 */

const deviceActivity = {}

const addActivity = window._.throttle(function addActivity (message) {
  const id = message.deviceID
  const activities = deviceActivity[id] = deviceActivity[id] || new Set()
  activities.add(message)
  renderActivities(id)
}, 100)

const renderActivities = window._.throttle(function renderActivities (id) {
  const cssID = window.CSS.escape(id)
  const activities = deviceActivity[id] = deviceActivity[id] || new Set()
  const parent = document.querySelector(`#${cssID}-indicator`)
  patch(parent, () => {
    activities.forEach(activity => {
      elementVoid('div', `${id}-activity-${activity.id}`, [
        'class', 'activity',
        'value', activity.messageType,
        'onanimationend', () => {
          activities.delete(activity)
          renderActivities(id)
        }
      ])
    })
  })
}, 100)

/**
 * Rendering
 */

function render () {
  const hasDevices = !!Object.keys(devices).length
  pairButton.classList.toggle('noDevices', !hasDevices)
  const emptyDevices = document.querySelector('#emptyDevices')
  emptyDevices.classList.toggle('show', !hasDevices)
  const devicesList = document.querySelector('#devicesList')

  patch(devicesList, () => {
    Object.values(devices).forEach((device) => {
      renderDeviceRow(device)
      deviceContextMenu(device.id)
    })
  })
}

function renderDeviceRow (data) {
  const { ready, id, device, server } = data
  const connected = !!(server && server.connected)

  elementOpen('div', id, [
    'id', id
  ], ...[
    'class', `deviceRow ${connected ? 'connected' : 'disconnected'} ${ready ? 'ready' : ''}`
  ])
  {
    elementOpen('div', `${id}-name`, [
      'itemprop', 'name'
    ])
    text(device.name)
    elementClose('div')

    deviceContextMenu(id)

    renderStatusMessage(id)

    elementOpen('div', `${id}-battery-wrapper`, [
      'class', 'battery'
    ])
    renderBatteryLevel(id, batteryLevels[id])
    elementClose('div')

    elementVoid('div', `${id}-settings`, [
      'class', 'settings mdi mdi-settings',
      'id', `${id}-settings`
    ])

    elementVoid('data', `${id}-indicator`, [
      'class', 'indicator',
      'id', `${id}-indicator`
    ])
  }
  elementClose('div')
}

function renderStatusMessage (id) {
  const { server, ready } = devices[id]
  const connected = !!(server && server.connected)
  elementOpen('div', `${id}-connected-${connected}-${ready}`, [
    'class', 'message'
  ])
  if (ready) {
    text(connected ? 'Ready' : 'Disconnected')
  } else {
    text(connected ? 'Waiting...' : 'Connecting...')
  }
  elementClose('div')
}

function renderBatteryLevel (id, level = 'unknown') {
  const { server } = devices[id]
  const connected = !!(server && server.connected)
  if (!connected) {
    elementVoid('data', `${id}-battery`, [
      'itemprop', 'battery'
    ], ...[
      'class', `battery mdi mdi-battery-outline`
    ])
    return
  }

  let title = level
  if (level <= 10) {
    level = 'alert'
    title = 'low'
  }

  if (Number(level)) {
    title = `${level}%`
  } else {
    title = window._.startCase(title)
  }

  elementVoid('data', `${id}-battery`, [
    'itemprop', 'battery'
  ], ...[
    'class', `battery mdi mdi-battery-${level}`,
    'title', `Battery ${title}`,
    'value', title.toLowerCase()
  ])
}

function patchBatteryLevel (id) {
  const cssID = window.CSS.escape(id)
  const battery = document.querySelector(`#${cssID} .battery`)
  patch(battery, () => {
    renderBatteryLevel(id, batteryLevels[id])
  })
}

/*
 * Context Menu
 */

const contextMenus = {}

function deviceContextMenu (id) {
  if (contextMenus[id]) {
    return
  }
  const cssID = window.CSS.escape(id)
  const target = document.querySelector(`#${cssID}-settings`)
  if (!target) return
  const menu = new ContextMenu(target, [
    {
      title: 'Disconnect',
      action: async () => {
        const { device } = devices[id]
        await device.gatt && device.gatt.disconnect()
        render()
      }
    }
  ], {
    callback: {
      opening () {
        window.addEventListener('resize', reset)
      },
      closure () {
        window.removeEventListener('resize', reset)
      }
    }
  })

  function reset () {
    if (!rect) return
    const newRect = target.getBoundingClientRect()
    menu._determinePosition({
      clientX: pos.clientX + newRect.left - rect.left,
      clientY: pos.clientY + newRect.top - rect.top
    })
    menu._setAndAdjustPosition()
  }

  const pos = {}
  let rect

  target.addEventListener('click', (event) => {
    rect = target.getBoundingClientRect()
    const newEvent = new window.CustomEvent('contextmenu')
    newEvent.altKey = event.altKey
    newEvent.which = event.which
    newEvent.clientX = event.clientX
    newEvent.clientY = event.clientY
    pos.clientX = event.clientX
    pos.clientY = event.clientY
    target.dispatchEvent(newEvent)
  })
  contextMenus[id] = menu
}

/**
 * Setup
 */

const port = window.JZZ().openMidiOut()
const pairButton = document.querySelector('#pair')
pairButton.addEventListener('click', tryAddController)
pairButton.removeAttribute('disabled')

/**
 * Start
 */

render()
