import { chainDataByChainId, Chains } from "@/libs/ethereum/mods/chain"
import { Objects } from "@/libs/objects/objects"
import { ping } from "@/libs/ping"
import { Sockets } from "@/libs/sockets/sockets"
import { Circuits } from "@/libs/tor/circuits/circuits"
import { Jwt } from "@/libs/wconn/mods/jwt/jwt"
import { Wc } from "@/libs/wconn/mods/wc/wc"
import { Box } from "@hazae41/box"
import { Ciphers, TlsClientDuplex } from "@hazae41/cadenas"
import { Disposer } from "@hazae41/disposer"
import { Circuit } from "@hazae41/echalote"
import { Ed25519 } from "@hazae41/ed25519"
import { Fleche } from "@hazae41/fleche"
import { RpcCounter } from "@hazae41/jsonrpc"
import { Mutex } from "@hazae41/mutex"
import { None } from "@hazae41/option"
import { Pool } from "@hazae41/piscine"
import { Result } from "@hazae41/result"
import { Signals } from "@hazae41/signals"

export interface WcBrume {
  readonly key: Ed25519.PrivateKey
  readonly circuits: Pool<Circuit>
  readonly sockets: Pool<Pool<WebSocketConnection>>
}

export type EthBrumes = Pool<EthBrume>

export interface EthBrume extends Chains<Pool<Pool<RpcConnection>>> {
  readonly circuits: Pool<Circuit>
}

export type Connection =
  | WebSocketConnection
  | UrlConnection

export class WebSocketConnection {

  #cooldown = Promise.resolve()

  constructor(
    readonly circuit: Circuit,
    readonly socket: WebSocket
  ) { }

  [Symbol.dispose]() {
    try {
      this.socket.close()
    } catch { }
  }

  get cooldown() {
    const cooldown = this.#cooldown
    this.#cooldown = this.#cooldown.then(() => new Promise<void>(ok => setTimeout(ok, 100)))
    return cooldown
  }

  isWebSocket(): this is WebSocketConnection {
    return true
  }

  isURL(): false {
    return false
  }

}

export class UrlConnection {

  constructor(
    readonly circuit: Circuit,
    readonly url: URL
  ) { }

  [Symbol.dispose]() { }

  isWebSocket(): false {
    return false
  }

  isURL(): this is UrlConnection {
    return true
  }

}

export namespace WcBrume {

  export async function createOrThrow(circuits: Mutex<Pool<Circuit>>, key: Ed25519.PrivateKey): Promise<WcBrume> {
    const relay = Wc.RELAY
    const auth = await Jwt.trySign(key, relay).then(r => r.unwrap())
    const projectId = "a6e0e589ca8c0326addb7c877bbb0857"
    const url = `${relay}/?auth=${auth}&projectId=${projectId}`

    const subcircuits = Circuits.subpool(circuits, 2)
    const subsockets = WebSocketConnection.createPools(subcircuits.get(), [url])

    return { key, circuits: subcircuits.get(), sockets: subsockets.get() }
  }

  export function createPool(circuits: Mutex<Pool<Circuit>>, size: number) {
    const pool = new Pool<WcBrume>(async () => {
      const key = await Ed25519.get().PrivateKey.randomOrThrow()
      const brume = new Box(await createOrThrow(circuits, key))

      /**
       * Wait for at least one ready circuit (or skip if all are errored)
       */
      await Promise.any(brume.inner.circuits.okPromises).catch(() => { })

      /**
       * Wait for at least one ready socket pool (or skip if all are errored)
       */
      await Promise.any(brume.inner.sockets.okPromises).catch(() => { })

      return new Disposer(brume, () => { })
    })

    for (let i = 0; i < size; i++)
      pool.start(i)

    return pool
  }
}

export namespace EthBrume {

  export function create(circuits: Mutex<Pool<Circuit>>): EthBrume {
    const subcircuits = Circuits.subpool(circuits, 3)
    const conns = Objects.mapValuesSync(chainDataByChainId, x => RpcCircuits.create(subcircuits.get(), x.urls))

    return { ...conns, circuits: subcircuits.get() }
  }

  export function createPool(circuits: Mutex<Pool<Circuit>>, size: number) {
    const pool = new Pool<EthBrume>(async (params) => {
      const brume = new Box(EthBrume.create(circuits))

      /**
       * Wait for at least one ready circuit (or skip if all are errored)
       */
      await Promise.any(brume.inner.circuits.okPromises).catch(() => { })

      return new Disposer(brume, () => { })
    })

    for (let i = 0; i < size; i++)
      pool.start(i)

    return pool
  }

}

export namespace WebSocketConnection {

  /**
   * Create a ws connection from a circuit and an url
   * @param circuit 
   * @param url 
   * @param signal 
   * @returns 
   */
  export async function createOrThrow(circuit: Circuit, url: URL, signal?: AbortSignal): Promise<WebSocketConnection> {
    const signal2 = Signals.merge(AbortSignal.timeout(ping.value * 5), signal)

    if (url.protocol === "wss:") {
      const tcp = await circuit.openOrThrow(url.hostname, 443)

      const ciphers = [Ciphers.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384, Ciphers.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384]
      const tls = new TlsClientDuplex({ ciphers, host_name: url.hostname })

      tcp.outer.readable.pipeTo(tls.inner.writable).catch(() => { })
      tls.inner.readable.pipeTo(tcp.outer.writable).catch(() => { })

      const socket = new Fleche.WebSocket(url)

      tls.outer.readable.pipeTo(socket.inner.writable).catch(() => { })
      socket.inner.readable.pipeTo(tls.outer.writable).catch(() => { })

      await Sockets.waitOrThrow(socket, signal2)

      return new WebSocketConnection(circuit, socket)
    }

    if (url.protocol === "ws:") {
      const tcp = await circuit.openOrThrow(url.hostname, 80)
      const socket = new Fleche.WebSocket(url)

      tcp.outer.readable.pipeTo(socket.inner.writable).catch(() => { })
      socket.inner.readable.pipeTo(tcp.outer.writable).catch(() => { })

      await Sockets.waitOrThrow(socket, signal2)

      return new WebSocketConnection(circuit, socket)
    }

    throw new Error(`Unknown protocol ${url.protocol}`)
  }

  /**
   * Create a pool of ws connections from a circuit and urls
   * @param circuit 
   * @param urls 
   * @returns 
   */
  export function createPool(circuit: Circuit, urls: readonly string[]) {
    const pool = new Pool<WebSocketConnection>(async (params) => {
      const { pool, index, signal } = params

      const url = new URL(urls[index])
      const raw = await WebSocketConnection.createOrThrow(circuit, url, signal)

      const onCloseOrError = async () => {
        pool.restart(index)
      }

      raw.socket.addEventListener("close", onCloseOrError, { passive: true })
      raw.socket.addEventListener("error", onCloseOrError, { passive: true })

      const box = new Box(raw)

      const onEntryClean = () => {
        using _ = box

        raw.socket.removeEventListener("close", onCloseOrError)
        raw.socket.removeEventListener("error", onCloseOrError)
      }

      return new Disposer(box, onEntryClean)
    })

    for (let i = 0; i < urls.length; i++)
      pool.start(i)

    return pool
  }

  /**
   * Create a pool of pool of ws connections from a pool of circuits and urls
   * @param subcircuits 
   * @param urls 
   * @returns 
   */
  export function createPools(subcircuits: Pool<Circuit>, urls: readonly string[]) {
    let update = Date.now()

    const pool = new Pool<Pool<WebSocketConnection>>(async (params) => {
      while (true) {
        const start = Date.now()

        const result = await Result.runAndWrap(async () => {
          const { pool, index } = params

          const circuit = await subcircuits.getOrThrow(index % subcircuits.length)
          const subpool = new Box(WebSocketConnection.createPool(circuit, urls))

          const onCloseOrError = async (reason?: unknown) => {
            pool.restart(index)
            return new None()
          }

          circuit.events.on("close", onCloseOrError, { passive: true })
          circuit.events.on("error", onCloseOrError, { passive: true })

          const onEntryClean = () => {
            circuit.events.off("close", onCloseOrError)
            circuit.events.off("error", onCloseOrError)
          }

          /**
           * Wait for at least one ready connection (or skip if all are errored)
           */
          await Promise.any(subpool.inner.okPromises).catch(() => { })

          return new Disposer(subpool, onEntryClean)
        })

        if (result.isOk())
          return result.get()

        if (start < update)
          continue

        throw result.getErr()
      }
    })

    const stack = new DisposableStack()

    const onStarted = () => {
      update = Date.now()

      for (let i = 0; i < pool.length; i++) {
        const slot = Result.runAndWrapSync(() => pool.getRawSyncOrThrow(i))

        if (slot.isErr())
          continue

        if (slot.get().isErr())
          pool.restart(i)

        continue
      }

      return new None()
    }

    subcircuits.events.on("started", onStarted, { passive: true })
    stack.defer(() => subcircuits.events.off("started", onStarted))

    for (let i = 0; i < subcircuits.length; i++)
      pool.start(i)

    return new Disposer(pool, () => stack.dispose())
  }

}

export class RpcConnection {

  readonly counter = new RpcCounter()

  constructor(
    readonly connection: Connection
  ) { }

  [Symbol.dispose]() {
    this.connection[Symbol.dispose]()
  }

}

export namespace RpcConnections {

  /**
   * Create a pool of rpc connections from a circuit and urls
   * @param circuit 
   * @param urls 
   * @returns 
   */
  export function create(circuit: Circuit, urls: readonly string[]) {
    const pool = new Pool<RpcConnection>(async (params) => {
      const { pool, index, signal } = params

      const url = new URL(urls[index])

      if (url.protocol === "http:" || url.protocol === "https:") {
        const box = new Box(new RpcConnection(new UrlConnection(circuit, url)))

        const onEntryClean = () => {
          using _ = box
        }

        return new Disposer(box, onEntryClean)
      }

      const raw = await WebSocketConnection.createOrThrow(circuit, url, signal)
      const box = new Box(new RpcConnection(raw))

      const onCloseOrError = async () => {
        pool.restart(index)
      }

      raw.socket.addEventListener("close", onCloseOrError, { passive: true })
      raw.socket.addEventListener("error", onCloseOrError, { passive: true })

      const onEntryClean = () => {
        using _ = box

        raw.socket.removeEventListener("close", onCloseOrError)
        raw.socket.removeEventListener("error", onCloseOrError)
      }

      return new Disposer(box, onEntryClean)
    })

    for (let i = 0; i < urls.length; i++)
      pool.start(i)

    return pool
  }

}

export namespace RpcCircuits {

  /**
   * Create a pool of pool of rpc connections from a pool of circuits and urls
   * @param subcircuits 
   * @param urls 
   * @returns 
   */
  export function create(subcircuits: Pool<Circuit>, urls: readonly string[]) {
    let update = Date.now()

    const pool = new Pool<Pool<RpcConnection>>(async (params) => {
      while (true) {
        const start = Date.now()

        const result = await Result.runAndWrap(async () => {
          const { pool, index } = params

          const circuit = await subcircuits.getOrThrow(index % subcircuits.length)
          const subpool = new Box(RpcConnections.create(circuit, urls))

          const onCloseOrError = async (reason?: unknown) => {
            pool.restart(index)
            return new None()
          }

          circuit.events.on("close", onCloseOrError, { passive: true })
          circuit.events.on("error", onCloseOrError, { passive: true })

          const onEntryClean = () => {
            circuit.events.off("close", onCloseOrError)
            circuit.events.off("error", onCloseOrError)
          }

          /**
           * Wait for at least one ready connection (or skip if all are errored)
           */
          await Promise.any(subpool.inner.okPromises).catch(() => { })

          return new Disposer(subpool, onEntryClean)
        })

        if (result.isOk())
          return result.get()

        if (start < update)
          continue

        throw result.getErr()
      }
    })

    const stack = new DisposableStack()

    const onStarted = () => {
      update = Date.now()

      for (let i = 0; i < pool.length; i++) {
        const slot = Result.runAndWrapSync(() => pool.getRawSyncOrThrow(i))

        if (slot.isErr())
          continue

        if (slot.get().isErr())
          pool.restart(i)

        continue
      }

      return new None()
    }

    subcircuits.events.on("started", onStarted, { passive: true })
    stack.defer(() => subcircuits.events.off("started", onStarted))

    for (let i = 0; i < subcircuits.length; i++)
      pool.start(i)

    return new Disposer(pool, () => stack.dispose())
  }

}