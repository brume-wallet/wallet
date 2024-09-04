import { chainDataByChainId } from "@/libs/ethereum/mods/chain"
import { Objects } from "@/libs/objects/objects"
import { ping } from "@/libs/ping"
import { SizedPool } from "@/libs/pool"
import { Sockets } from "@/libs/sockets/sockets"
import { Circuits } from "@/libs/tor/circuits/circuits"
import { Box } from "@hazae41/box"
import { Ciphers, TlsClientDuplex } from "@hazae41/cadenas"
import { Disposer } from "@hazae41/disposer"
import { Circuit } from "@hazae41/echalote"
import { Ed25519 } from "@hazae41/ed25519"
import { Fleche } from "@hazae41/fleche"
import { RpcCounter } from "@hazae41/jsonrpc"
import { Jwt, Wc } from "@hazae41/latrine"
import { Pool } from "@hazae41/piscine"
import { Result } from "@hazae41/result"

export interface WcBrume {
  readonly key: Ed25519.SigningKey
  readonly circuits: SizedPool<Circuit>
  readonly sockets: SizedPool<Disposer<SizedPool<WebSocketConnection>>>
}

export type EthBrumes = SizedPool<EthBrume>

export interface EthBrume {
  readonly [chainId: number]: Disposer<SizedPool<Disposer<SizedPool<RpcConnection>>>>
  readonly circuits: SizedPool<Circuit>
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

  export async function createOrThrow(circuits: SizedPool<Circuit>, key: Ed25519.SigningKey): Promise<WcBrume> {
    const relay = Wc.RELAY
    const auth = await Jwt.signOrThrow(key, relay)
    const projectId = "a6e0e589ca8c0326addb7c877bbb0857"
    const url = `${relay}/?auth=${auth}&projectId=${projectId}`

    const subcircuits = Circuits.createCircuitSubpool(circuits, 2)
    const subsockets = WebSocketConnection.createPools(subcircuits.get(), [url])

    return { key, circuits: subcircuits.get(), sockets: subsockets.get() }
  }

  export function createPool(circuits: SizedPool<Circuit>, size: number) {
    const pool = new Pool<WcBrume>(async () => {
      const key = await Ed25519.get().getOrThrow().SigningKey.randomOrThrow()
      const brume = new Box(await createOrThrow(circuits, key))

      /**
       * Wait for at least one ready circuit (or skip if all are errored)
       */
      await Promise.any(brume.getOrThrow().circuits.pool.okPromises).catch(() => { })

      /**
       * Wait for at least one ready socket pool (or skip if all are errored)
       */
      await Promise.any(brume.getOrThrow().sockets.pool.okPromises).catch(() => { })

      return new Disposer(brume, () => { })
    })

    return new Disposer(SizedPool.start(pool, size), () => { })
  }
}

export namespace EthBrume {

  export function create(circuits: SizedPool<Circuit>): EthBrume {
    const subcircuits = Circuits.createCircuitSubpool(circuits, 3)
    const conns = Objects.mapValuesSync(chainDataByChainId, x => RpcCircuits.createRpcCircuitsPool(subcircuits.get(), x.urls))

    return { ...conns, circuits: subcircuits.get() } satisfies EthBrume
  }

  export function createPool(circuits: SizedPool<Circuit>, size: number) {
    const pool = new Pool<EthBrume>(async (params) => {
      const brume = new Box(EthBrume.create(circuits))

      /**
       * Wait for at least one ready circuit (or skip if all are errored)
       */
      await Promise.any(brume.getOrThrow().circuits.pool.okPromises).catch(() => { })

      return new Disposer(brume, () => { })
    })

    return new Disposer(SizedPool.start(pool, size), () => { })
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
  export async function createOrThrow(circuit: Circuit, url: URL, signal = new AbortController().signal): Promise<WebSocketConnection> {
    const signal2 = AbortSignal.any([AbortSignal.timeout(ping.value * 5), signal])

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
      const { index, signal } = params

      using stack = new Box(new DisposableStack())

      const url = new URL(urls[index])
      const raw = await WebSocketConnection.createOrThrow(circuit, url, signal)
      const box = new Box(raw)
      stack.getOrThrow().use(box)

      const onCloseOrError = () => void pool.restart(index)

      raw.socket.addEventListener("close", onCloseOrError, { passive: true })
      stack.getOrThrow().defer(() => raw.socket.removeEventListener("close", onCloseOrError))

      raw.socket.addEventListener("error", onCloseOrError, { passive: true })
      stack.getOrThrow().defer(() => raw.socket.removeEventListener("error", onCloseOrError))

      const unstack = stack.unwrapOrThrow()

      return new Disposer(box, () => unstack.dispose())
    })

    return new Disposer(SizedPool.start(pool, urls.length), () => { })
  }

  /**
   * Create a pool of pool of ws connections from a pool of circuits and urls
   * @param subcircuits 
   * @param urls 
   * @returns 
   */
  export function createPools(subcircuits: SizedPool<Circuit>, urls: readonly string[]) {
    let update = Date.now()

    const pool = new Pool<Disposer<SizedPool<WebSocketConnection>>>(async (params) => {
      const { index, signal } = params

      while (!signal.aborted) {
        const start = Date.now()

        const result = await Result.runAndWrap(async () => {
          using stack = new Box(new DisposableStack())

          const circuit = await subcircuits.pool.getOrThrow(index % subcircuits.size, signal)
          const subpool = new Box(WebSocketConnection.createPool(circuit, urls))
          stack.getOrThrow().use(subpool)

          const onCloseOrError = () => void pool.restart(index)

          stack.getOrThrow().defer(circuit.events.on("close", onCloseOrError, { passive: true }))
          stack.getOrThrow().defer(circuit.events.on("error", onCloseOrError, { passive: true }))

          /**
           * Wait for at least one ready connection (or skip if all are errored)
           */
          await Promise.any(subpool.getOrThrow().get().pool.okPromises).catch(() => { })

          const unstack = stack.unwrapOrThrow()

          return new Disposer(subpool, () => unstack.dispose())
        })

        if (result.isOk())
          return result.get()

        if (start < update)
          continue

        throw result.getErr()
      }

      throw new Error("Aborted", { cause: signal.reason })
    })

    const onStarted = () => {
      update = Date.now()

      for (const entry of pool.errEntries)
        pool.restart(entry.index)

      return
    }

    const stack = new DisposableStack()

    subcircuits.pool.events.on("started", onStarted, { passive: true })
    stack.defer(() => subcircuits.pool.events.off("started", onStarted))

    return new Disposer(SizedPool.start(pool, subcircuits.size), () => stack.dispose())
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
   * Create a pool of rpc connections for each url using the given circuit
   * @param circuit 
   * @param urls 
   * @returns 
   */
  export function createRpcConnectionsPool(circuit: Circuit, urls: readonly string[]) {
    const pool = new Pool<RpcConnection>(async (params) => {
      const { index, signal } = params

      using stack = new Box(new DisposableStack())

      const url = new URL(urls[index])

      if (url.protocol === "http:" || url.protocol === "https:") {
        const raw = new UrlConnection(circuit, url)
        const box = new Box(new RpcConnection(raw))
        stack.getOrThrow().use(box)

        const unstack = stack.unwrapOrThrow()

        return new Disposer(box, () => unstack.dispose())
      }

      const raw = await WebSocketConnection.createOrThrow(circuit, url, signal)
      const box = new Box(new RpcConnection(raw))
      stack.getOrThrow().use(box)

      const onCloseOrError = () => void pool.restart(index)

      raw.socket.addEventListener("close", onCloseOrError, { passive: true })
      stack.getOrThrow().defer(() => raw.socket.removeEventListener("close", onCloseOrError))

      raw.socket.addEventListener("error", onCloseOrError, { passive: true })
      stack.getOrThrow().defer(() => raw.socket.removeEventListener("error", onCloseOrError))

      const unstack = stack.unwrapOrThrow()

      return new Disposer(box, () => unstack.dispose())
    })

    return new Disposer(SizedPool.start(pool, urls.length), () => { })
  }

}

export namespace RpcCircuits {

  /**
   * Create a pool of rpc connections for each url and for each circuit
   * @param subcircuits 
   * @param urls 
   * @returns 
   */
  export function createRpcCircuitsPool(subcircuits: SizedPool<Circuit>, urls: readonly string[]) {
    let update = Date.now()

    const pool = new Pool<Disposer<SizedPool<RpcConnection>>>(async (params) => {
      const { index, signal } = params

      while (!signal.aborted) {
        const start = Date.now()

        const result = await Result.runAndWrap(async () => {
          using stack = new Box(new DisposableStack())

          const circuit = await subcircuits.pool.getOrThrow(index % subcircuits.size, signal)
          const subpool = new Box(RpcConnections.createRpcConnectionsPool(circuit, urls))
          stack.getOrThrow().use(subpool)

          const onCloseOrError = () => void pool.restart(index)

          stack.getOrThrow().defer(circuit.events.on("close", onCloseOrError, { passive: true }))
          stack.getOrThrow().defer(circuit.events.on("error", onCloseOrError, { passive: true }))

          /**
           * Wait for at least one ready connection (or skip if all are errored)
           */
          await Promise.any(subpool.getOrThrow().get().pool.okPromises).catch(() => { })

          const unstack = stack.unwrapOrThrow()

          return new Disposer(subpool, () => unstack.dispose())
        })

        if (result.isOk())
          return result.get()

        if (start < update)
          continue

        throw result.getErr()
      }

      throw new Error("Aborted", { cause: signal.reason })
    })

    const onStarted = () => {
      update = Date.now()

      for (const entry of pool.errEntries)
        pool.restart(entry.index)

      return
    }

    const stack = new DisposableStack()

    subcircuits.pool.events.on("started", onStarted, { passive: true })
    stack.defer(() => subcircuits.pool.events.off("started", onStarted))

    return new Disposer(SizedPool.start(pool, subcircuits.size), () => stack.dispose())
  }

}