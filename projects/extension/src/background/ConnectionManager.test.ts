/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { jest } from "@jest/globals"
import { ConnectionManager } from "./ConnectionManager"
import westend from "../../public/assets/westend.json"
import kusama from "../../public/assets/kusama.json"
import { MockPort } from "../mocks"
import { chrome } from "jest-chrome"
import { App } from "./types"
import { NetworkMainInfo } from "../types"

let port: MockPort
let manager: ConnectionManager

const waitForMessageToBePosted = (): Promise<null> => {
  // window.postMessge is async so we must do a short setTimeout to yield to
  // the event loop
  return new Promise((resolve) => setTimeout(resolve, 10, null))
}

const connectApp = (
  manager: ConnectionManager,
  tabId: number,
  name: string,
  network: string,
): MockPort => {
  const port = new MockPort(`${name}::${network}`)
  port.setTabId(tabId)
  manager.addApp(port)
  return port
}

const doNothing = () => {
  // Do nothing
}

test("adding and removing apps changes state", async () => {
  //setup connection manager with 2 chains
  const manager = new ConnectionManager()
  await manager.addChain(JSON.stringify(westend), doNothing)
  await manager.addChain(JSON.stringify(kusama), doNothing)

  const handler = jest.fn()
  manager.on("stateChanged", handler)

  // app connects to first network
  connectApp(manager, 42, "test-app", "westend")
  expect(handler).toHaveBeenCalledTimes(1)
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app",
        tabId: 42,
        networks: [{ name: "westend" }],
      },
    ],
  })

  // app connects to second network
  handler.mockClear()
  connectApp(manager, 42, "test-app", "kusama")
  expect(handler).toHaveBeenCalledTimes(1)
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app",
        tabId: 42,
        networks: [{ name: "westend" }, { name: "kusama" }],
      },
    ],
  })

  // different app connects to second network
  handler.mockClear()
  const port = connectApp(manager, 43, "another-app", "kusama")
  expect(handler).toHaveBeenCalledTimes(1)
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app",
        tabId: 42,
        networks: [{ name: "westend" }, { name: "kusama" }],
      },
      {
        name: "another-app",
        tabId: 43,
        networks: [{ name: "kusama" }],
      },
    ],
  })

  // disconnect second app
  handler.mockClear()
  port.triggerDisconnect()
  expect(handler).toHaveBeenCalled()
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app",
        tabId: 42,
        networks: [{ name: "westend" }, { name: "kusama" }],
      },
    ],
  })

  handler.mockClear()
  manager.disconnectTab(42)
  expect(handler).toHaveBeenCalledTimes(2)
  expect(manager.getState()).toEqual({ apps: [] })

  // Connect 2 apps on the same network and 2nd one on another network
  // in order to test disconnectAll functionality
  handler.mockClear()
  // first app connects to network
  connectApp(manager, 1, "test-app-1", "westend")
  expect(handler).toHaveBeenCalledTimes(1)
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app-1",
        tabId: 1,
        networks: [{ name: "westend" }],
      },
    ],
  })

  // second app connects to same network
  handler.mockClear()
  connectApp(manager, 2, "test-app-2", "westend")
  connectApp(manager, 2, "test-app-2", "kusama")
  expect(handler).toHaveBeenCalledTimes(2)
  expect(manager.getState()).toEqual({
    apps: [
      {
        name: "test-app-1",
        tabId: 1,
        networks: [{ name: "westend" }],
      },
      {
        name: "test-app-2",
        tabId: 2,
        networks: [{ name: "westend" }, { name: "kusama" }],
      },
    ],
  })
  handler.mockClear()
  // disconnect all apps;
  manager.disconnectAll()
  expect(handler).toHaveBeenCalledTimes(3)
  expect(manager.getState()).toEqual({ apps: [] })
  await manager.shutdown()
}, 30000)

test("Tries to connect to a parachain with unknown Relay Chain", async () => {
  const port = new MockPort("test-app-7::westend")
  const manager = new ConnectionManager()
  const handler = jest.fn()
  await manager.addChain(JSON.stringify(westend), doNothing)
  manager.on("stateChanged", handler)
  manager.addApp(port)
  await waitForMessageToBePosted()

  port.triggerMessage({
    type: "spec",
    payload: "",
    parachainPayload: JSON.stringify({
      name: "parachainSpec",
      relay_chain: "someRelayChain",
    }),
  })
  await waitForMessageToBePosted()
  const errorMsg = {
    type: "error",
    payload: "Relay chain spec was not found",
  }
  expect(port.postMessage).toHaveBeenCalledWith(errorMsg)
  expect(port.disconnect).toHaveBeenCalled()

  await manager.shutdown()
})

describe("Unit tests", () => {
  let manager: ConnectionManager
  const handler = jest.fn()

  beforeAll(async () => {
    manager = new ConnectionManager()
    //setup connection manager with 2 networks
    await manager.addChain(JSON.stringify(westend), doNothing)
    await manager.addChain(JSON.stringify(kusama), doNothing)
    manager.on("stateChanged", handler)

    //add 4 apps in clients
    connectApp(manager, 11, "test-app-1", "westend")
    connectApp(manager, 12, "test-app-2", "kusama")
    connectApp(manager, 13, "test-app-3", "westend")
    connectApp(manager, 14, "test-app-4", "kusama")
  })

  afterAll(async () => {
    await manager.shutdown()
  })

  test("Get registered apps", () => {
    expect(manager.registeredApps).toEqual([
      "test-app-1::westend",
      "test-app-2::kusama",
      "test-app-3::westend",
      "test-app-4::kusama",
    ])
  })

  test("Get registered clients", () => {
    expect(manager.registeredNetworks).toEqual([
      { name: "westend", status: "connected", id: "westend2" },
      { name: "kusama", status: "connected", id: "ksmcc3" },
    ])
  })

  test("Get apps", () => {
    expect(manager.apps).toHaveLength(4)
  })

  test("Get networks/chains", () => {
    // With this look the "chain" is removed intentionally as "chain"
    // object cannot be compared with jest
    const tmpChains = manager.registeredNetworks.map((n: NetworkMainInfo) => ({
      name: n.name,
      status: n.status,
    }))

    expect(tmpChains).toEqual([
      { name: "westend", status: "connected" },
      { name: "kusama", status: "connected" },
    ])

    expect(manager.registeredNetworks).toHaveLength(2)
  })

  test("Adding an app that already exists sends an error and disconnects", () => {
    const port = connectApp(manager, 13, "test-app-3", "westend")
    expect(port.postMessage).toHaveBeenCalledTimes(1)
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: "error",
      payload: "App test-app-3::westend already exists.",
    })
    expect(port.disconnect).toHaveBeenCalled()
  })
})

describe("Check storage and send notification when adding an app", () => {
  const westendPayload = JSON.stringify({ name: "Westend", id: "westend2" })
  const port = new MockPort("test-app-7::westend")
  const manager = new ConnectionManager()
  const handler = jest.fn()
  let app: App

  chrome.storage.sync.get.mockImplementation((keys, callback) => {
    callback({ notifications: true })
  })

  beforeEach(() => {
    chrome.storage.sync.get.mockClear()
    chrome.notifications.create.mockClear()
  })

  beforeAll(async () => {
    await manager.addChain(JSON.stringify(westend), doNothing)
    await manager.addChain(JSON.stringify(kusama), doNothing)
    manager.on("stateChanged", handler)

    manager.addApp(port)
    await waitForMessageToBePosted()
  }, 30000)

  afterAll(async () => {
    await manager.shutdown()
  })

  test("Checks storage for notifications preferences", () => {
    port.triggerMessage({ type: "spec", payload: westendPayload })
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1)
  })

  test("Sends a notification", () => {
    port.triggerMessage({ type: "spec", payload: westendPayload })
    const notificationData = {
      message: "App test-app-7 connected to westend.",
      title: "Substrate Connect",
      iconUrl: "./icons/icon-32.png",
      type: "basic",
    }

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      "test-app-7::westend",
      notificationData,
    )
  })
})

describe("Tests with actual ConnectionManager", () => {
  let app: App
  const manager = new ConnectionManager()
  beforeEach(() => {
    port = new MockPort("test-app::westend")
    app = manager.createApp(port)
  })

  afterAll(() => {
    void manager.shutdown()
  })

  test("Construction parses the port name and gets port information", () => {
    expect(app.name).toBe("test-app::westend")
    expect(app.appName).toBe("test-app")
    expect(app.url).toBe(port.sender.url)
    expect(app.tabId).toBe(port.sender.tab.id)
  })

  test("Connected state", () => {
    app = manager.createApp(port)
    port.triggerMessage({ type: "spec", payload: "westend" })
    port.triggerMessage({ type: "rpc", payload: '{ "id": 1 }' })

    expect(app.state).toBe("connected")
  })

  test("Disconnect cleans up properly", async () => {
    app = manager.createApp(port)
    port.triggerMessage({ type: "spec", payload: "westend" })
    await waitForMessageToBePosted()
    manager.disconnect(app)
    await waitForMessageToBePosted()
    expect(app.state).toBe("disconnected")
  })

  test("Invalid port name sends an error and disconnects", () => {
    port = new MockPort("invalid")
    const errorMsg = {
      type: "error",
      payload: "Invalid port name invalid expected <app_name>::<chain_name>",
    }
    expect(() => {
      manager.createApp(port)
    }).toThrow(errorMsg.payload)
    expect(port.postMessage).toHaveBeenCalledWith(errorMsg)
    expect(port.disconnect).toHaveBeenCalled()
  })

  test("Connected state", () => {
    port.triggerMessage({ type: "spec", payload: "westend" })
    port.triggerMessage({ type: "rpc", payload: '{ "id": 1 }' })
    expect(app.state).toBe("connected")
  })

  test("Spec message adds a chain", async () => {
    port.triggerMessage({ type: "spec", payload: "westend" })
    await waitForMessageToBePosted()
    expect(app.healthChecker).toBeDefined()
  })

  test("Buffers RPC messages before spec message", async () => {
    const message1 = JSON.stringify({ id: 1, jsonrpc: "2.0", result: {} })
    port.triggerMessage({ type: "rpc", payload: message1 })
    const message2 = JSON.stringify({ id: 2, jsonrpc: "2.0", result: {} })
    port.triggerMessage({ type: "rpc", payload: message2 })
    port.triggerMessage({ type: "spec", payload: "westend" })
    await waitForMessageToBePosted()
    expect(app.healthChecker).toBeDefined()
  })

  test("RPC port message sends the message to the chain", async () => {
    port.triggerMessage({ type: "spec", payload: "westend" })
    await waitForMessageToBePosted()
    const message = JSON.stringify({ id: 1, jsonrpc: "2.0", result: {} })
    port.triggerMessage({ type: "rpc", payload: message })
    await waitForMessageToBePosted()
  })

  test("App already disconnected", async () => {
    app = manager.createApp(port)
    port.triggerMessage({ type: "spec", payload: "westend" })
    await waitForMessageToBePosted()
    manager.disconnect(app)
    await waitForMessageToBePosted()
    expect(() => {
      manager.disconnect(app)
    }).toThrowError("Cannot disconnect - already disconnected")
  })
})
