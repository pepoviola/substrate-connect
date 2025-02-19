import { RpcCoder } from "@polkadot/rpc-provider/coder"
import type {
  ProviderInterface,
  ProviderInterfaceCallback,
  ProviderInterfaceEmitted,
  ProviderInterfaceEmitCb,
  JsonRpcResponse,
} from "@polkadot/rpc-provider/types"
import EventEmitter from "eventemitter3"
import type { Chain, JsonRpcCallback } from "../connector/types.js"

import { WellKnownChain } from "../WellKnownChain.js"
import { createScClient } from "../connector/index.js"
import { healthChecker } from "./Health.js"

export interface PolkadotJsScClient {
  addWellKnownChain: (
    wellKnownChain: WellKnownChain,
  ) => Promise<ProviderInterface>
  addChain: (chainSpec: string) => Promise<ProviderInterface>
}

type ResponseCallback = (response: string | Error) => void

// These methods have been taken from:
// https://github.com/paritytech/smoldot/blob/17425040ddda47d539556eeaf62b88c4240d1d42/src/json_rpc/methods.rs#L338-L462
// It's important to take into account that smoldot is adding support to the new
// json-rpc-interface https://paritytech.github.io/json-rpc-interface-spec/
// However, at the moment this list only includes methods that belong to the "old" API
const subscriptionUnsubscriptionMethods = new Map<string, string>([
  ["author_submitAndWatchExtrinsic", "author_unwatchExtrinsic"],
  ["chain_subscribeAllHeads", "chain_unsubscribeAllHeads"],
  ["chain_subscribeFinalizedHeads", "chain_unsubscribeFinalizedHeads"],
  ["chain_subscribeFinalisedHeads", "chain_subscribeFinalisedHeads"],
  ["chain_subscribeNewHeads", "chain_unsubscribeNewHeads"],
  ["chain_subscribeNewHead", "chain_unsubscribeNewHead"],
  ["chain_subscribeRuntimeVersion", "chain_unsubscribeRuntimeVersion"],
  ["subscribe_newHead", "unsubscribe_newHead"],
  ["state_subscribeRuntimeVersion", "state_unsubscribeRuntimeVersion"],
  ["state_subscribeStorage", "state_unsubscribeStorage"],
])

class Provider implements ProviderInterface {
  readonly #coder: RpcCoder = new RpcCoder()
  readonly #getChain: (handler: JsonRpcCallback) => Promise<Chain>
  readonly #subscriptions: Map<
    string,
    [ResponseCallback, { unsubscribeMethod: string; id: string | number }]
  > = new Map()
  readonly #requests: Map<number, ResponseCallback> = new Map()
  readonly #eventemitter: EventEmitter = new EventEmitter()
  #chain: Promise<Chain> | null = null
  #isChainReady: boolean = false

  public constructor(getChain: (handler: JsonRpcCallback) => Promise<Chain>) {
    this.#getChain = getChain
  }

  public get hasSubscriptions(): boolean {
    // Indicates that subscriptions are supported
    return true
  }

  public get isConnected(): boolean {
    return !!this.#chain && this.#isChainReady
  }

  public clone(): ProviderInterface {
    throw new Error("clone() is not supported.")
  }

  async connect(): Promise<void> {
    if (this.isConnected) throw new Error("Already connected!")

    // it could happen that after emitting `disconnected` due to the fact taht
    // smoldot is syncing, the consumer tries to reconnect after a certain amount
    // of time... In which case we want to make sure that we don't create a new
    // chain.
    if (this.#chain) {
      await this.#chain
      return
    }

    const hc = healthChecker()
    const onResponse = (res: string): void => {
      let hcRes = hc.responsePassThrough(res)
      if (!hcRes) return

      const response = JSON.parse(hcRes) as JsonRpcResponse
      let decodedResponse: string | Error
      try {
        decodedResponse = this.#coder.decodeResponse(response) as string
      } catch (e) {
        decodedResponse = e as Error
      }

      // It's not a subscription message, but rather a standar RPC response
      if (response.params?.subscription === undefined) {
        return this.#requests.get(response.id)?.(decodedResponse)
      }

      // We are dealing with a subscription message
      const subscriptionId = `${response.method}::${response.params.subscription}`

      const callback = this.#subscriptions.get(subscriptionId)?.[0]
      callback?.(decodedResponse)
    }

    this.#chain = this.#getChain(onResponse).then((chain) => {
      hc.setSendJsonRpc(chain.sendJsonRpc)

      this.#isChainReady = false
      const cleanup = () => {
        // If there are any callbacks left, we have to reject/error them.
        // Otherwise, that would cause a memory leak.
        const disconnectionError = new Error("Disconnected")
        this.#requests.forEach((cb) => cb(disconnectionError))
        this.#subscriptions.forEach(([cb]) => cb(disconnectionError))
        this.#subscriptions.clear()
      }

      let staleSubscriptions: {
        unsubscribeMethod: string
        id: number | string
      }[] = []
      const killStaleSubscriptions = () => {
        if (staleSubscriptions.length === 0) return

        const { unsubscribeMethod, id } = staleSubscriptions.pop()!
        Promise.race([
          this.send(unsubscribeMethod, [id]).catch(() => {}),
          new Promise((res) => setTimeout(res, 500)),
        ]).then(killStaleSubscriptions)
      }

      hc.start((health) => {
        const isReady =
          !health.isSyncing && (health.peers > 0 || !health.shouldHavePeers)

        // if it's the same as before, then nothing has changed and we are done
        if (this.#isChainReady === isReady) return

        this.#isChainReady = isReady
        if (!isReady) {
          // If we've reached this point, that means that the chain used to be "ready"
          // and now we are about to emit `disconnected`.
          //
          // This will cause the PolkadotJs API think that the connection is
          // actually dead. In reality the smoldot chain is not dead, of course.
          // However, we have to cleanup all the existing callbacks because when
          // the smoldot chain stops syncing, then we will emit `connected` and
          // the PolkadotJs API will try to re-create the previous
          // subscriptions and requests. Although, now is not a good moment
          // to be sending unsubscription messages to the smoldot chain, we
          // should wait until is no longer syncing to send the unsubscription
          // messages from the stale subscriptions of the previous connection.
          //
          // That's why -before we perform the cleanup of `this.#subscriptions`-
          // we keep the necessary information that we will need later on to
          // kill the stale subscriptions.
          ;[...this.#subscriptions.values()].forEach((s) => {
            staleSubscriptions.push(s[1])
          })
          cleanup()
        } else {
          killStaleSubscriptions()
        }

        this.#eventemitter.emit(isReady ? "connected" : "disconnected")
      })

      return {
        ...chain,
        sendJsonRpc: hc.sendJsonRpc.bind(hc),
        remove: () => {
          hc.stop()
          cleanup()
          chain.remove()
        },
      }
    })

    try {
      await this.#chain
    } catch (e) {
      this.#chain = null
      this.#eventemitter.emit("error", e)
      throw e
    }
  }

  async disconnect(): Promise<void> {
    if (!this.#chain) return

    const chain = await this.#chain
    this.#chain = null
    this.#isChainReady = false
    try {
      chain.remove()
    } catch (_) {}
    this.#eventemitter.emit("disconnected")
  }

  public on(
    type: ProviderInterfaceEmitted,
    sub: ProviderInterfaceEmitCb,
  ): () => void {
    // It's possible. Although, quite unlikely, that by the time that polkadot
    // subscribes to the `connected` event, the Provider is already connected.
    // In that case, we must emit to let the consumer know that we are connected.
    if (type === "connected" && this.isConnected) {
      sub()
    }

    this.#eventemitter.on(type, sub)
    return (): void => {
      this.#eventemitter.removeListener(type, sub)
    }
  }

  public async send(method: string, params: unknown[]): Promise<any> {
    if (!this.isConnected) throw new Error("Provider is not connected")

    const chain = await this.#chain!
    const json = this.#coder.encodeJson(method, params)
    const id = this.#coder.getId()

    const result = new Promise((res, rej): void => {
      this.#requests.set(id, (response) => {
        ;(response instanceof Error ? rej : res)(response)
      })
      try {
        chain.sendJsonRpc(json)
      } catch (e) {
        this.#chain = null
        try {
          chain.remove()
        } catch (_) {}
        this.#eventemitter.emit("error", e)
      }
    })

    try {
      return await result
    } catch (e) {
      throw e
    } finally {
      // let's ensure that once the Promise is resolved/rejected, then we remove
      // remove its entry from the internal #requests
      this.#requests.delete(id)
    }
  }

  public async subscribe(
    type: string,
    method: string,
    params: any[],
    callback: ProviderInterfaceCallback,
  ): Promise<number | string> {
    if (!subscriptionUnsubscriptionMethods.has(method))
      throw new Error(`Unsupported subscribe method: ${method}`)

    const id = await this.send(method, params)
    const subscriptionId = `${type}::${id}`
    const cb = (response: Error | string) => {
      if (response instanceof Error) {
        callback(response, undefined)
      } else {
        callback(null, response)
      }
    }

    const unsubscribeMethod = subscriptionUnsubscriptionMethods.get(method)!
    this.#subscriptions.set(subscriptionId, [cb, { unsubscribeMethod, id }])
    return id
  }

  public unsubscribe(
    type: string,
    method: string,
    id: number | string,
  ): Promise<boolean> {
    if (!this.isConnected) throw new Error("Provider is not connected")

    const subscriptionId = `${type}::${id}`

    if (!this.#subscriptions.has(subscriptionId)) {
      return Promise.reject(
        new Error(`Unable to find active subscription=${subscriptionId}`),
      )
    }
    this.#subscriptions.delete(subscriptionId)

    return this.send(method, [id])
  }
}

/**
 * Returns a {ScClient} that connects to chains, either through the substrate-connect
 * extension or by executing a light client directly from JavaScript, depending on whether the
 * extension is installed and available.
 *
 * The chains returned by `addChain` and `addWellKnownChain` implement the `ProviderInterface`
 * trait of the `@polkadot/api` library.
 */
export const createPolkadotJsScClient = (): PolkadotJsScClient => {
  const client = createScClient()

  return {
    addChain: async (chainSpec: string) => {
      const provider = new Provider((callback: JsonRpcCallback) =>
        client.addChain(chainSpec, callback),
      )
      await provider.connect()
      return provider
    },
    addWellKnownChain: async (wellKnownChain: WellKnownChain) => {
      const provider = new Provider((callback: JsonRpcCallback) =>
        client.addWellKnownChain(wellKnownChain, callback),
      )
      await provider.connect()
      return provider
    },
  }
}
