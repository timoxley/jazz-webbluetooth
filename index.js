const devices = {}

const port = window.JZZ().openMidiOut()
const { patch, elementOpen, elementClose, text } = window.IncrementalDOM

async function tryAddController () {
  try {
    const controller = await addController()
    const { id, device, characteristic } = controller
    device.addEventListener('gattserverdisconnected', () => {
      render()
    })

    characteristic.addEventListener('characteristicvaluechanged', event => {
      try {
        const { value } = event.target
        const b = []
        // Convert raw data bytes to hex values just for the sake of showing something.
        // In the "real" world, you'd use data.getUint8, data.getUint16 or even
        // TextDecoder to process raw data bytes.
        for (let i = 0; i < value.byteLength; i++) {
          b.push(value.getUint8(i))
        }
        deviceEvent(id, b.slice(-3))
      } catch (err) {
        console.log(err)
      }
    })

    await characteristic.startNotifications()

    devices[id] = controller
    render()
  } catch (err) {
    console.error(err)
  }
}

async function addController () {
  const serviceUuid = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
  const characteristicUuid = '7772e5db-3868-4112-a1a9-f2669d106bf3'
  const device = await navigator.bluetooth.requestDevice({
    filters: [{services: [serviceUuid]}]
  })

  const server = await device.gatt.connect()
  const service = await server.getPrimaryService(serviceUuid)
  const characteristic = await service.getCharacteristic(characteristicUuid)

  return {
    id: device.id,
    characteristic,
    device,
    service,
    server
  }
}

function deviceRow (data) {
  const { id, device } = data
  console.log(data)

  elementOpen('div', `${id}-name`, [
    'itemprop', 'name'
  ])
  text(device.name)
  elementClose('div')
  deviceConnected(data)
}

function deviceConnected (data) {
  const { id, server } = data
  const connected = !!(server && server.connected)
  elementOpen('div', `${id}-connected`, [
    'itemprop', 'connected',
    'id', `${id}-status`
  ], ...[
    'title', (connected ? 'Connected' : 'Disconnected'),
    'value', (connected ? 'connected' : 'disconnected')
  ])

  elementOpen('span', `${id}-connected-${connected}`, [
    'class', 'title'
  ])
  text(connected ? 'Connected' : 'Disconnected')
  elementClose('span')

  elementOpen('div', `${id}-indicator`, [
    'class', 'indicator',
    'id', `${id}-indicator`
  ])

  elementClose('div')
  elementClose('div')
}

function deviceEvent (id, data) {
  port.send(data.slice(-3))
  activity(id)
}

const activity = window._.throttle(function activity (id) {
  const cssID = window.CSS.escape(id)
  const parent = document.querySelector(`#${cssID}-indicator`)
  const el = document.createElement('div')
  el.classList.add('activity')
  parent.appendChild(el)
  const fn = () => {
    parent.removeChild(el)
    el.removeEventListener('animationend', fn, false)
  }
  el.addEventListener('animationend', fn, false)
}, 100)

function render () {
  const devicesList = document.querySelector('#devicesList')
  patch(devicesList, () => {
    Object.values(devices).forEach((device) => {
      deviceRow(device)
    })
  })
}

window.devices = devices

const pairButton = document.querySelector('#pair')
pairButton.addEventListener('click', tryAddController)
pairButton.removeAttribute('disabled')
