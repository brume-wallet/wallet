import "@hazae41/symbol-dispose-polyfill";

import "@hazae41/disposable-stack-polyfill";

import "@hazae41/worker-online-polyfill";

import { Blobs } from "@/libs/blobs/blobs";
import { BrowserError, browser } from "@/libs/browser/browser";
import { ExtensionRpcRouter, MessageRpcRouter, RpcRouter } from "@/libs/channel/channel";
import { Console } from "@/libs/console";
import { chainDataByChainId } from "@/libs/ethereum/mods/chain";
import { fetchAsBlobOrThrow } from "@/libs/fetch";
import { Mutators } from "@/libs/glacier/mutators";
import { Mime } from "@/libs/mime/mime";
import { Mouse } from "@/libs/mouse/mouse";
import { Objects } from "@/libs/objects/objects";
import { ping } from "@/libs/ping";
import { isAndroidApp, isAppleApp, isChromeExtension, isExtension, isFirefoxExtension, isIpad, isProdWebsite, isSafariExtension, isWebsite } from "@/libs/platform/platform";
import { Strings } from "@/libs/strings/strings";
import { Circuits } from "@/libs/tor/circuits/circuits";
import { createNativeWebSocketPool, createTorPool } from "@/libs/tor/tors/tors";
import { pathOf, urlOf } from "@/libs/url/url";
import { randomUUID } from "@/libs/uuid/uuid";
import { IrnBrume } from "@/libs/wconn/mods/irn/irn";
import { UnauthorizedError } from "@/mods/foreground/errors/errors";
import { Base16 } from "@hazae41/base16";
import { Base58 } from "@hazae41/base58";
import { Base64 } from "@hazae41/base64";
import { Base64Url } from "@hazae41/base64url";
import { Bytes } from "@hazae41/bytes";
import { Cadenas } from "@hazae41/cadenas";
import { ChaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { ZeroHexAsInteger, ZeroHexString } from "@hazae41/cubane";
import { Disposer } from "@hazae41/disposer";
import { Circuit, Echalote, TorClientDuplex } from "@hazae41/echalote";
import { Ed25519 } from "@hazae41/ed25519";
import { Fleche, fetch } from "@hazae41/fleche";
import { Future } from "@hazae41/future";
import { AesGcmCoder, Data, HmacEncoder, IDBStorage, RawState, SimpleQuery, State, core } from "@hazae41/glacier";
import { Immutable } from "@hazae41/immutable";
import { RpcError, RpcRequestInit, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "@hazae41/jsonrpc";
import { Kcp } from "@hazae41/kcp";
import { Keccak256 } from "@hazae41/keccak256";
import { CryptoClient, Wc, WcMetadata, WcSession, WcSessionRequestParams } from "@hazae41/latrine";
import { Mutex } from "@hazae41/mutex";
import { None, Nullable, Option, Some } from "@hazae41/option";
import { Pool } from "@hazae41/piscine";
import { SuperEventTarget } from "@hazae41/plume";
import { Result } from "@hazae41/result";
import { Ripemd160 } from "@hazae41/ripemd160";
import { Secp256k1 } from "@hazae41/secp256k1";
import { Sha1 } from "@hazae41/sha1";
import { Smux } from "@hazae41/smux";
import { X25519 } from "@hazae41/x25519";
import { BlobbyQuery, BlobbyRef } from "../../universal/entities/blobbys/data";
import { OriginData, OriginQuery, PreOriginData } from "../../universal/entities/origins/data";
import { SeedData, SeedQuery } from "../../universal/entities/seeds/data";
import { SettingsQuery } from "../../universal/entities/settings/data";
import { BgEthereumContext } from "./context";
import { EthBrume, WcBrume } from "./entities/brumes/data";
import { BgEns } from "./entities/names/data";
import { AppRequest, AppRequestData, BgAppRequest } from "./entities/requests/data";
import { BgSession, ExSessionData, SessionData, SessionRef, SessionStorage, WcSessionData } from "./entities/sessions/data";
import { Status, StatusData } from "./entities/sessions/status/data";
import { BgSimulation } from "./entities/simulations/data";
import { BgToken } from "./entities/tokens/data";
import { BgUser, User, UserData, UserInit } from "./entities/users/data";
import { BgWallet, EthereumFetchParams, EthereumQueryKey, Wallet, WalletData, WalletRef } from "./entities/wallets/data";
import { createUserStorageOrThrow } from "./storage";

declare const self: ServiceWorkerGlobalScope

if (isWebsite() || isAndroidApp())
  self.addEventListener("install", () => self.skipWaiting())

declare const FILES: [string, string][]

if (isProdWebsite()) {
  const cache = new Immutable.Cache(new Map(FILES))

  self.addEventListener("activate", (event) => {
    event.waitUntil(cache.uncache())
    event.waitUntil(cache.precache())
  })

  self.addEventListener("fetch", (event) => cache.handle(event))
}

interface PopupData {
  tab: chrome.tabs.Tab,
  router: RpcRouter
}

interface Slot<T> {
  current?: T
}

interface PermissionRequest {
  readonly [methodName: string]: {
    readonly [caveatName: string]: any;
  }
}

interface RequestedPermission {
  readonly parentCapability: string;
  readonly date?: number;
}

interface Caveat {
  readonly type: string;
  readonly value: any;
}

interface Permission {
  readonly invoker: string;
  readonly parentCapability: string;
  readonly caveats: Caveat[];
}

export class Global {

  readonly events = new SuperEventTarget<{
    "user": (user: UserSession) => void,
    "popup": (router: RpcRouter) => void,
    "response": (response: RpcResponseInit<unknown>) => void
  }>()

  #user?: UserSession
  #path: string = "/"

  readonly popup = new Mutex<Slot<PopupData>>({})

  readonly tors: Mutex<Pool<TorClientDuplex>>
  readonly sockets: Mutex<Pool<Disposer<WebSocket>>>
  readonly circuits: Mutex<Pool<Circuit>>

  readonly wcBrumes: Mutex<Pool<WcBrume>>
  readonly ethBrumes: Mutex<Pool<EthBrume>>

  readonly accountsByScript = new Map<string, string[]>()
  readonly chainIdByScript = new Map<string, Nullable<number>>()

  constructor(
    readonly storage: IDBStorage
  ) {
    this.sockets = new Mutex(createNativeWebSocketPool(1).get())
    this.tors = new Mutex(createTorPool(this.sockets, storage, 1).get())
    this.circuits = new Mutex(Circuits.createCircuitPool(this.tors, storage, 8).get())

    this.wcBrumes = new Mutex(WcBrume.createPool(this.circuits, 1).get())
    this.ethBrumes = new Mutex(EthBrume.createPool(this.circuits, 1).get())

    core.onState.on(BgAppRequest.All.key, async () => {
      const state = core.getStateSync(BgAppRequest.All.key) as State<AppRequest[], never>

      const badge = Option
        .wrap(state?.data?.get()?.length)
        .filterSync(x => x > 0)
        .mapSync(String)
        .unwrapOr("")

      await Result.runAndWrap(async () => {
        await browser.action.setBadgeBackgroundColor({ color: "#ba77ff" })
        await browser.action.setBadgeTextColor({ color: "white" })
        await browser.action.setBadgeText({ text: badge })
      }).then(r => r.ignore())

      return new None()
    })
  }

  async setCurrentUserOrThrow(uuid: Nullable<string>, password: Nullable<string>): Promise<Nullable<UserSession>> {
    if (uuid == null)
      return undefined
    if (password == null)
      return undefined

    if (this.#user != null)
      return this.#user

    const userQuery = BgUser.schema(uuid, this.storage)
    const userState = await userQuery.state
    const userData = Option.unwrap(userState.current?.get())

    const user: User = { ref: true, uuid: userData.uuid }

    const { storage, hasher, crypter } = await createUserStorageOrThrow(userData, password)

    const currentUserQuery = BgUser.Current.schema(storage)
    await currentUserQuery.mutate(() => new Some(new Data(user)))

    const userSession = UserSession.create(this, { user, storage, hasher, crypter })

    this.#user = userSession

    await this.events.emit("user", userSession)
    await this.#wcReconnectAllOrThrow()

    return userSession
  }

  async waitPopupHelloOrThrow(tab: chrome.tabs.Tab) {
    const future = new Future<RpcRouter>()

    const onRequest = (foreground: RpcRouter) => {
      future.resolve(foreground)
      return new Some(undefined)
    }

    const onRemoved = (id: number) => {
      if (id !== tab.id)
        return
      future.reject(new Error())
    }

    try {
      this.events.on("popup", onRequest, { passive: true })
      browser.tabs.onRemoved.addListener(onRemoved)

      return await future.promise
    } finally {
      this.events.off("popup", onRequest)
      browser.tabs.onRemoved.removeListener(onRemoved)
    }
  }

  async openOrFocusPopupOrThrow(pathOrUrl: string | URL, mouse: Mouse, force?: boolean): Promise<PopupData> {
    return await this.popup.lock(async (slot) => {
      if (slot.current != null) {
        const tabId = Option.unwrap(slot.current.tab.id)
        const windowId = Option.unwrap(slot.current.tab.windowId)

        const url = force
          ? `popup.html#/?_=${encodeURIComponent(pathOf(pathOrUrl))}`
          : undefined

        await Result.runAndWrap(() => {
          return BrowserError.runOrThrow(() => browser.tabs.update(tabId, { url, highlighted: true }))
        }).then(r => r.ignore())

        await Result.runAndWrap(() => {
          return BrowserError.runOrThrow(() => browser.windows.update(windowId, { focused: true }))
        }).then(r => r.ignore())

        return slot.current
      }

      const height = 700
      const width = 400

      const top = Math.max(mouse.y - (height / 2), 0)
      const left = Math.max(mouse.x - (width / 2), 0)

      const tab = "create" in browser.windows
        ? await BrowserError.runOrThrow(() => browser.windows.create({ type: "popup", url: `popup.html#/?_=${encodeURIComponent(pathOf(pathOrUrl))}`, state: "normal", height, width, top, left }).then(w => w.tabs?.[0]))
        : await BrowserError.runOrThrow(() => browser.tabs.create({ url: `popup.html#/?_=${encodeURIComponent(pathOf(pathOrUrl))}`, active: true }))

      if (tab == null)
        throw new Error("Failed to create tab")

      const router = await this.waitPopupHelloOrThrow(tab)

      slot.current = { tab, router: router }

      const onRemoved = (tabId: number) => {
        if (tabId !== tab.id)
          return

        slot.current = undefined

        browser.tabs.onRemoved.removeListener(onRemoved)
      }

      browser.tabs.onRemoved.addListener(onRemoved)

      return slot.current
    })
  }

  async requestOrThrow<T>(request: AppRequestData, mouse?: Mouse): Promise<RpcResponse<T>> {
    if (mouse != null)
      return await this.requestPopupOrThrow(request, mouse)

    return await this.requestNoPopupOrThrow(request)
  }

  async requestNoPopupOrThrow<T>(request: AppRequestData): Promise<RpcResponse<T>> {
    const requestQuery = BgAppRequest.schema(request.id)
    await requestQuery.mutate(Mutators.data<AppRequestData, never>(request))

    const done = new Future<void>()

    try {
      return await this.waitResponseOrThrow(request.id, done)
    } finally {
      await requestQuery.delete()
      done.resolve()
    }
  }

  async requestPopupOrThrow<T>(request: AppRequestData, mouse: Mouse): Promise<RpcResponse<T>> {
    const requestQuery = BgAppRequest.schema(request.id)
    await requestQuery.mutate(Mutators.data<AppRequestData, never>(request))

    const done = new Future<void>()

    try {
      const { id, method, params } = request
      const url = urlOf(`/${method}?id=${id}`, params)

      if (isSafariExtension() && isIpad()) {
        this.#path = `#${pathOf(url)}`

        await BrowserError.runOrThrow(() => (browser.browserAction as any).openPopup())
        const response = await this.waitResponseOrThrow<T>(request.id, done)

        return response
      }

      const popup = await this.openOrFocusPopupOrThrow(url, mouse)
      const response = await this.waitPopupResponseOrThrow<T>(request.id, popup, done)

      return response
    } finally {
      await requestQuery.delete()
      done.resolve()
    }
  }

  async getOrWaitUserOrThrow(mouse: Mouse) {
    if (this.#user != null)
      return this.#user

    if (isSafariExtension() && isIpad()) {
      await BrowserError.runOrThrow(() => (browser.browserAction as any).openPopup())

      const user = await this.events.wait("user", (future: Future<UserSession>, user: UserSession) => {
        future.resolve(user)
        return new None()
      }).await()

      return user
    }

    const popup = await this.openOrFocusPopupOrThrow("/", mouse)
    return await this.waitUserOrPopupRemovalOrThrow(popup)
  }

  async waitUserOrPopupRemovalOrThrow(popup: PopupData) {
    using stack = new DisposableStack()

    const resolveOnUser = new Future<UserSession>()
    const rejectOnRemove = new Future<never>()

    const onUser = (user: UserSession) => {
      resolveOnUser.resolve(user)
      return new None()
    }

    const onRemoved = (id: number) => {
      if (id !== popup.tab.id)
        return
      rejectOnRemove.reject(new Error())
    }

    stack.defer(this.events.on("user", onUser))

    browser.tabs.onRemoved.addListener(onRemoved)
    stack.defer(() => browser.tabs.onRemoved.removeListener(onRemoved))

    return await Promise.race([resolveOnUser.promise, rejectOnRemove.promise])
  }

  async waitResponseOrThrow<T>(id: string, done: Future<void>) {
    const future = new Future<RpcResponse<T>>()

    const onResponse = async (init: RpcResponseInit<any>) => {
      if (init.id !== id)
        return new None()

      const response = RpcResponse.from<T>(init)
      future.resolve(response)

      return new Some(await done.promise)
    }

    try {
      this.events.on("response", onResponse, { passive: true })

      return await future.promise
    } finally {
      this.events.off("response", onResponse)
    }
  }

  async waitPopupResponseOrThrow<T>(id: string, popup: PopupData, done: Future<void>) {
    const future = new Future<RpcResponse<T>>()

    const onResponse = async (init: RpcResponseInit<any>) => {
      if (init.id !== id)
        return new None()

      const response = RpcResponse.from<T>(init)
      future.resolve(response)

      return new Some(await done.promise)
    }

    const onRemoved = (id: number) => {
      if (id !== popup.tab.id)
        return
      future.reject(new Error())
    }

    try {
      this.events.on("response", onResponse, { passive: true })
      browser.tabs.onRemoved.addListener(onRemoved)

      return await future.promise
    } finally {
      this.events.off("response", onResponse)
      browser.tabs.onRemoved.removeListener(onRemoved)
    }
  }

  async getExtensionSessionOrThrow(script: RpcRouter, mouse: Mouse, wait: boolean): Promise<Nullable<ExSessionData>> {
    const user = Option.unwrap(this.#user)

    let mutex = user.sessionByScript.get(script.name)

    if (mutex == null) {
      mutex = new Mutex<Slot<string>>({})
      user.sessionByScript.set(script.name, mutex)
    }

    return await mutex.lock(async slot => {
      if (this.#user == null && !wait)
        return undefined

      const { storage } = await this.getOrWaitUserOrThrow(mouse)

      const currentSession = slot.current

      if (currentSession != null) {
        const sessionQuery = BgSession.schema(currentSession, storage)
        const sessionState = await sessionQuery.state
        const sessionData = Option.unwrap(sessionState.data?.get())

        if (sessionData.type === "wc")
          throw new Error("Unexpected WalletConnect session")

        return sessionData
      }

      const preOriginData = await script.requestOrThrow<PreOriginData>({
        method: "brume_origin"
      }).then(r => r.unwrap())

      const { origin, title, description } = preOriginData
      const iconQuery = Option.unwrap(BlobbyQuery.create(origin, storage))
      const iconRef = BlobbyRef.create(origin)

      if (preOriginData.icon) {
        const iconData = { id: origin, data: preOriginData.icon }
        await iconQuery.mutate(Mutators.data(iconData))
      }

      const originQuery = Option.unwrap(OriginQuery.create(origin, storage))
      const originData: OriginData = { origin, title, description, icons: [iconRef] }
      await originQuery.mutate(Mutators.data(originData))

      const sessionByOriginQuery = BgSession.ByOrigin.schema(origin, storage)
      const sessionByOriginState = await sessionByOriginQuery.state

      if (sessionByOriginState.data != null) {
        const sessionId = sessionByOriginState.data.get().id

        const sessionQuery = BgSession.schema(sessionId, storage)
        const sessionState = await sessionQuery.state
        const sessionData = Option.unwrap(sessionState.data?.get())

        if (sessionData.type === "wc")
          throw new Error("Unexpected WalletConnect session")

        slot.current = sessionId

        let scripts = user.scriptsBySession.get(sessionId)

        if (scripts == null) {
          scripts = new Set()
          user.scriptsBySession.set(sessionId, scripts)
        }

        scripts.add(script)

        const { id } = sessionData
        await Status.schema(id).mutate(Mutators.data<StatusData, never>({ id }))

        script.events.on("close", async () => {
          scripts!.delete(script)
          user.sessionByScript.delete(script.name)

          if (scripts!.size === 0) {
            const { id } = sessionData
            await Status.schema(id).delete()
          }

          return new None()
        })

        const { chainId } = sessionData.chain

        if (this.chainIdByScript.has(script.name) && this.chainIdByScript.get(script.name) !== chainId) {
          script.requestOrThrow({
            method: "chainChanged",
            params: [ZeroHexAsInteger.fromOrThrow(chainId)]
          }).then(r => r.unwrap()).catch(() => { })

          script.requestOrThrow({
            method: "networkChanged",
            params: [chainId.toString()]
          }).then(r => r.unwrap()).catch(() => { })
        }

        return sessionData
      }

      if (!wait)
        return undefined

      const userChainState = await SettingsQuery.Chain.create(storage).state
      const userChainId = Option.wrap(userChainState.data?.get()).unwrapOr(1)
      const userChainData = Option.unwrap(chainDataByChainId[userChainId])

      const [persistent, wallets] = await this.requestPopupOrThrow<[boolean, Wallet[]]>({
        id: randomUUID(),
        origin: origin,
        method: "eth_requestAccounts",
        params: {}
      }, mouse).then(r => r.unwrap())

      const sessionData: ExSessionData = {
        type: "ex",
        id: randomUUID(),
        origin: origin,
        persist: persistent,
        wallets: wallets.map(wallet => WalletRef.from(wallet)),
        chain: userChainData
      }

      const sessionQuery = BgSession.schema(sessionData.id, storage)
      await sessionQuery.mutate(Mutators.data<SessionData, never>(sessionData))

      slot.current = sessionData.id

      let scripts = user.scriptsBySession.get(sessionData.id)

      if (scripts == null) {
        scripts = new Set()
        user.scriptsBySession.set(sessionData.id, scripts)
      }

      scripts.add(script)

      const { id } = sessionData
      await Status.schema(id).mutate(Mutators.data<StatusData, never>({ id }))

      script.events.on("close", async () => {
        scripts!.delete(script)
        user.sessionByScript.delete(script.name)

        if (scripts!.size === 0) {
          const { id } = sessionData
          await Status.schema(id).delete().catch(console.warn)
        }

        return new None()
      })

      if (this.chainIdByScript.has(script.name) && this.chainIdByScript.get(script.name) !== userChainId) {
        script.requestOrThrow<void>({
          method: "chainChanged",
          params: [ZeroHexAsInteger.fromOrThrow(userChainId)]
        }).then(r => r.unwrap()).catch(() => { })

        script.requestOrThrow({
          method: "networkChanged",
          params: [userChainId.toString()]
        }).then(r => r.unwrap()).catch(() => { })
      }

      return sessionData
    })
  }

  async routeContentScriptOrThrow(script: RpcRouter, request: RpcRequestPreinit<unknown>) {
    if (request.method === "brume_icon")
      return new Some(await this.brume_icon(script, request))
    if (request.method === "brume_run")
      return new Some(await this.brume_run(script, request))
    return new None()
  }

  async brume_icon(script: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<string> {
    return await Blobs.readAsDataUrlOrThrow(await fetchAsBlobOrThrow("/favicon.png"))
  }

  async brume_run(script: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<unknown> {
    const [subrequest, mouse] = (request as RpcRequestPreinit<[RpcRequestPreinit<unknown>, Mouse]>).params

    let session = await this.getExtensionSessionOrThrow(script, mouse, false)

    if (subrequest.method === "eth_accounts" && session == null) {
      this.accountsByScript.set(script.name, [])
      return []
    }

    if (subrequest.method === "eth_coinbase" && session == null) {
      this.accountsByScript.set(script.name, [])
      return null
    }

    if (subrequest.method === "eth_chainId" && session == null) {
      this.chainIdByScript.set(script.name, null)
      return null
    }

    if (subrequest.method === "net_version" && session == null) {
      this.chainIdByScript.set(script.name, null)
      return null
    }

    session = await this.getExtensionSessionOrThrow(script, mouse, true)

    if (session == null)
      throw new UnauthorizedError()

    const { wallets } = session

    const user = Option.unwrap(this.#user)
    const wallet = Option.unwrap(wallets[0])

    const chain = session.chain
    const brume = await user.getOrTakeEthBrumeOrThrow(wallet.uuid)

    const context: BgEthereumContext = { chain: chain, brume }

    if (subrequest.method === "eth_requestAccounts")
      return await this.eth_requestAccounts(context, session, subrequest)
    if (subrequest.method === "eth_accounts")
      return await this.eth_accounts(context, session, subrequest)
    if (subrequest.method === "eth_coinbase")
      return await this.eth_coinbase(context, session, subrequest)
    if (subrequest.method === "eth_chainId")
      return await this.eth_chainId(context, session, subrequest)
    if (subrequest.method === "net_version")
      return await this.net_version(context, session, subrequest)
    if (subrequest.method === "wallet_requestPermissions")
      return await this.wallet_requestPermissions(context, session, subrequest)
    if (subrequest.method === "wallet_getPermissions")
      return await this.wallet_getPermissions(context, session, subrequest)
    if (subrequest.method === "eth_sendTransaction")
      return await this.eth_sendTransaction(context, session, subrequest, mouse)
    if (subrequest.method === "personal_sign")
      return await this.personal_sign(context, session, subrequest, mouse)
    if (subrequest.method === "eth_signTypedData_v4")
      return await this.eth_signTypedData_v4(context, session, subrequest, mouse)
    if (subrequest.method === "wallet_switchEthereumChain")
      return await this.wallet_switchEthereumChain(context, session, subrequest, mouse)

    return await BgEthereumContext.fetchOrFail(context, { ...subrequest, noCheck: true }).then(r => r.unwrap())
  }

  async eth_requestAccounts(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<string[]> {
    const user = Option.unwrap(this.#user)

    return await Promise.all(session.wallets.map(async wallet => {
      const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
      const walletState = await walletQuery.state
      const walletData = Option.unwrap(walletState.data?.get())

      return walletData.address
    }))
  }

  async eth_accounts(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<string[]> {
    const user = Option.unwrap(this.#user)

    return await Promise.all(session.wallets.map(async wallet => {
      const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
      const walletState = await walletQuery.state
      const walletData = Option.unwrap(walletState.data?.get())

      return walletData.address
    }))
  }

  async eth_coinbase(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<Nullable<string>> {
    const user = Option.unwrap(this.#user)

    const walletRef = session.wallets.at(0)

    if (walletRef == null)
      return

    const walletQuery = BgWallet.schema(walletRef.uuid, user.storage)
    const walletState = await walletQuery.state
    const walletData = Option.unwrap(walletState.data?.get())

    return walletData.address
  }

  async eth_chainId(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<string> {
    if (session.type === "wc")
      throw new Error("Unexpected WalletConnect session")

    return ZeroHexAsInteger.fromOrThrow(session.chain.chainId)
  }

  async net_version(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<string> {
    if (session.type === "wc")
      throw new Error("Unexpected WalletConnect session")

    return session.chain.chainId.toString()
  }

  async wallet_requestPermissions(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<RequestedPermission[]> {
    const [prequest] = (request as RpcRequestPreinit<[PermissionRequest]>).params

    return Object.keys(prequest).map(it => ({ parentCapability: it }))
  }

  async wallet_getPermissions(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>): Promise<Permission[]> {
    return [{ invoker: session.origin, parentCapability: "eth_accounts", caveats: [] }]
  }

  async eth_getBalance(ethereum: BgEthereumContext, request: RpcRequestPreinit<unknown>): Promise<unknown> {
    const user = Option.unwrap(this.#user)

    const [address, block] = (request as RpcRequestPreinit<[ZeroHexString, string]>).params

    const query = BgToken.Native.Balance.schema(address, block, ethereum, user.storage)

    try { await query.fetch() } catch { }

    const stored = core.storeds.get(query.cacheKey)
    const unstored = await core.unstoreOrThrow<any, unknown, any>(stored, { key: query.cacheKey })
    const fetched = Option.unwrap(unstored.current)

    return fetched
  }

  async eth_sendTransaction(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>, mouse?: Mouse): Promise<string> {
    const user = Option.unwrap(this.#user)

    const [{ from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas }] = (request as RpcRequestPreinit<[{
      from: string,
      to: Nullable<string>,
      gas: Nullable<string>,
      value: Nullable<string>,
      nonce: Nullable<string>,
      data: Nullable<string>,
      gasPrice: Nullable<string>,
      maxFeePerGas: Nullable<string>,
      maxPriorityFeePerGas: Nullable<string>,
    }]>).params

    const wallets = await Promise.all(session.wallets.map(async wallet => {
      const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
      const walletState = await walletQuery.state
      return Option.unwrap(walletState.data?.get())
    }))

    /**
     * TODO: maybe ensure two wallets can't have the same address in the same session
     */
    const maybeWallet = wallets.find(wallet => Strings.equalsIgnoreCase(wallet.address, from))
    const walletId = Option.unwrap(maybeWallet?.uuid)

    const chainId = ZeroHexAsInteger.fromOrThrow(ethereum.chain.chainId)

    const hash = await this.requestOrThrow<string>({
      id: randomUUID(),
      method: "eth_sendTransaction",
      params: { walletId, chainId, from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas },
      origin: session.origin,
      session: session.id
    }, mouse).then(r => r.unwrap())

    return hash
  }

  async personal_sign(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>, mouse?: Mouse): Promise<string> {
    const user = Option.unwrap(this.#user)

    const [message, address] = (request as RpcRequestPreinit<[string, string]>).params

    const wallets = await Promise.all(session.wallets.map(async wallet => {
      const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
      const walletState = await walletQuery.state
      return Option.unwrap(walletState.data?.get())
    }))

    /**
     * TODO: maybe ensure two wallets can't have the same address in the same session
     */
    const maybeWallet = wallets.find(wallet => Strings.equalsIgnoreCase(wallet.address, address))
    const walletId = Option.unwrap(maybeWallet?.uuid)

    const chainId = ZeroHexAsInteger.fromOrThrow(ethereum.chain.chainId)

    const signature = await this.requestOrThrow<string>({
      id: randomUUID(),
      method: "personal_sign",
      params: { message, address, walletId, chainId },
      origin: session.origin,
      session: session.id
    }, mouse).then(r => r.unwrap())

    return signature
  }

  async eth_signTypedData_v4(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>, mouse?: Mouse): Promise<string> {
    const user = Option.unwrap(this.#user)

    const [address, data] = (request as RpcRequestPreinit<[string, string]>).params

    const wallets = await Promise.all(session.wallets.map(async wallet => {
      const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
      const walletState = await walletQuery.state
      return Option.unwrap(walletState.data?.get())
    }))

    /**
     * TODO: maybe ensure two wallets can't have the same address in the same session
     */
    const maybeWallet = wallets.find(wallet => Strings.equalsIgnoreCase(wallet.address, address))
    const walletId = Option.unwrap(maybeWallet?.uuid)

    const chainId = ZeroHexAsInteger.fromOrThrow(ethereum.chain.chainId)

    const signature = await this.requestOrThrow<string>({
      id: randomUUID(),
      method: "eth_signTypedData_v4",
      params: { data, address, walletId, chainId },
      origin: session.origin,
      session: session.id
    }, mouse).then(r => r.unwrap())

    return signature
  }

  async wallet_switchEthereumChain(ethereum: BgEthereumContext, session: SessionData, request: RpcRequestPreinit<unknown>, mouse: Mouse): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [{ chainId }] = (request as RpcRequestPreinit<[{ chainId: string }]>).params

    const chain = Option.unwrap(chainDataByChainId[Number(chainId)])

    const sessionQuery = BgSession.schema(session.id, user.storage)
    const sessionState = await sessionQuery.state
    const sessionData = Option.unwrap(sessionState.data?.get())

    if (sessionData.type === "wc")
      throw new Error("Unexpected WalletConnect session")

    await sessionQuery.mutate(() => new Some(new Data({ ...sessionData, chain })))

    for (const script of Option.wrap(user.scriptsBySession.get(session.id)).unwrapOr([])) {
      script.requestOrThrow({
        method: "chainChanged",
        params: [ZeroHexAsInteger.fromOrThrow(chain.chainId)]
      }).then(r => r.unwrap()).catch(() => { })

      script.requestOrThrow({
        method: "networkChanged",
        params: [chain.chainId.toString()]
      }).then(r => r.unwrap()).catch(() => { })
    }
  }

  async routeForegroundOrThrow(foreground: RpcRouter, request: RpcRequestInit<unknown>) {
    if (request.method === "brume_getPath")
      return new Some(await this.brume_getPath(request))
    if (request.method === "brume_setPath")
      return new Some(await this.brume_setPath(request))
    if (request.method === "brume_login")
      return new Some(await this.brume_login(request))
    if (request.method === "brume_createUser")
      return new Some(await this.brume_createUser(foreground, request))
    if (request.method === "brume_createSeed")
      return new Some(await this.brume_createSeed(foreground, request))
    if (request.method === "brume_createWallet")
      return new Some(await this.brume_createWallet(foreground, request))
    if (request.method === "brume_switchEthereumChain")
      return new Some(await this.brume_switchEthereumChain(foreground, request))
    if (request.method === "brume_disconnect")
      return new Some(await this.brume_disconnect(foreground, request))
    if (request.method === "brume_get_global")
      return new Some(await this.brume_get_global(foreground, request))
    if (request.method === "brume_get_user")
      return new Some(await this.brume_get_user(foreground, request))
    if (request.method === "brume_set_user")
      return new Some(await this.brume_set_user(request))
    if (request.method === "brume_eth_fetch")
      return new Some(await this.brume_eth_fetch(foreground, request))
    if (request.method === "brume_eth_custom_fetch")
      return new Some(await this.brume_eth_custom_fetch(foreground, request))
    if (request.method === "brume_log")
      return new Some(await this.brume_log(request))
    if (request.method === "brume_encrypt")
      return new Some(await this.brume_encrypt(foreground, request))
    if (request.method === "brume_decrypt")
      return new Some(await this.brume_decrypt(foreground, request))
    if (request.method === "brume_wc_connect")
      return new Some(await this.brume_wc_connect(foreground, request))
    if (request.method === "brume_wc_status")
      return new Some(await this.brume_wc_connect(foreground, request))
    if (request.method === "popup_hello")
      return new Some(await this.popup_hello(foreground, request))
    if (request.method === "brume_respond")
      return new Some(await this.brume_respond(foreground, request))
    return new None()
  }

  async brume_getPath(request: RpcRequestPreinit<unknown>): Promise<string> {
    return this.#path
  }

  async brume_setPath(request: RpcRequestPreinit<unknown>): Promise<void> {
    const [path] = (request as RpcRequestPreinit<[string]>).params

    this.#path = path
  }

  async popup_hello(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    await this.events.emit("popup", foreground)
  }

  async brume_respond(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const [response] = (request as RpcRequestPreinit<[RpcResponseInit<unknown>]>).params

    await this.events.emit("response", response)
  }

  async brume_createUser(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const [init] = (request as RpcRequestPreinit<[UserInit]>).params

    const userData = await BgUser.createOrThrow(init)
    const userQuery = BgUser.schema(init.uuid, this.storage)
    await userQuery.mutate(() => new Some(new Data(userData)))
  }

  async brume_login(request: RpcRequestPreinit<unknown>): Promise<void> {
    const [uuid, password] = (request as RpcRequestPreinit<[string, string]>).params

    await this.setCurrentUserOrThrow(uuid, password)
  }

  async brume_getCurrentUser(request: RpcRequestPreinit<unknown>): Promise<Nullable<UserData>> {
    const userSession = this.#user

    if (userSession == null)
      return

    const userQuery = BgUser.schema(userSession.user.uuid, this.storage)
    const userState = await userQuery.state

    return userState.current?.get()
  }

  async brume_switchEthereumChain(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [sessionId, chainId] = (request as RpcRequestPreinit<[string, string]>).params

    const chain = Option.unwrap(chainDataByChainId[Number(chainId)])

    const sessionQuery = BgSession.schema(sessionId, user.storage)
    const sessionState = await sessionQuery.state
    const sessionData = Option.unwrap(sessionState.data?.get())

    if (sessionData.type === "wc")
      throw new Error("Unexpected WalletConnect session")

    await sessionQuery.mutate(() => new Some(new Data({ ...sessionData, chain })))

    for (const script of Option.wrap(user.scriptsBySession.get(sessionId)).unwrapOr([])) {
      script.requestOrThrow({
        method: "chainChanged",
        params: [ZeroHexAsInteger.fromOrThrow(chain.chainId)]
      }).then(r => r.unwrap()).catch(() => { })

      script.requestOrThrow({
        method: "networkChanged",
        params: [chain.chainId.toString()]
      }).then(r => r.unwrap()).catch(() => { })
    }
  }

  async brume_disconnect(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [id] = (request as RpcRequestPreinit<[string]>).params

    const sessionQuery = BgSession.schema(id, user.storage)
    await sessionQuery.delete()

    const wcSession = user.wcBySession.get(id)

    if (wcSession != null) {
      await wcSession.closeOrThrow(undefined)
      user.wcBySession.delete(id)
    }

    for (const script of Option.wrap(user.scriptsBySession.get(id)).unwrapOr([])) {
      script.requestOrThrow({
        method: "accountsChanged",
        params: [[]]
      }).then(r => r.unwrap()).catch(() => { })

      this.chainIdByScript.delete(script.name)
      this.accountsByScript.delete(script.name)

      user.sessionByScript.delete(script.name)
    }

    user.scriptsBySession.delete(id)
  }

  async brume_encrypt(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<[string, string]> {
    const [plainBase64] = (request as RpcRequestPreinit<[string]>).params

    const { crypter } = Option.unwrap(this.#user)

    const plain = Base64.get().decodePaddedOrThrow(plainBase64).copyAndDispose()
    const iv = Bytes.random(16)
    const cipher = await crypter.encryptOrThrow(plain, iv)

    const ivBase64 = Base64.get().encodePaddedOrThrow(iv)
    const cipherBase64 = Base64.get().encodePaddedOrThrow(cipher)

    return [ivBase64, cipherBase64]
  }

  async brume_decrypt(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<string> {
    const [ivBase64, cipherBase64] = (request as RpcRequestPreinit<[string, string]>).params

    const { crypter } = Option.unwrap(this.#user)

    const iv = Base64.get().decodePaddedOrThrow(ivBase64).copyAndDispose()
    const cipher = Base64.get().decodePaddedOrThrow(cipherBase64).copyAndDispose()
    const plain = await crypter.decryptOrThrow(cipher, iv)

    const plainBase64 = Base64.get().encodePaddedOrThrow(plain)

    return plainBase64
  }

  async brume_createSeed(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [seed] = (request as RpcRequestPreinit<[SeedData]>).params

    const seedQuery = Option.unwrap(SeedQuery.create(seed.uuid, user.storage))
    await seedQuery.mutate(Mutators.data(seed))
  }

  async brume_createWallet(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [wallet] = (request as RpcRequestPreinit<[WalletData]>).params

    const walletQuery = BgWallet.schema(wallet.uuid, user.storage)
    await walletQuery.mutate(Mutators.data(wallet))
  }

  async brume_get_global(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<Nullable<RawState>> {
    const [cacheKey] = (request as RpcRequestPreinit<[string]>).params

    const state = await core.getOrCreateMutex(cacheKey).lock(async () => {
      const cached = core.storeds.get(cacheKey)

      if (cached != null)
        return cached

      const stored = await this.storage.getOrThrow(cacheKey)
      core.storeds.set(cacheKey, stored)
      core.unstoreds.delete(cacheKey)

      await core.onState.emit("*", cacheKey)
      await core.onState.emit(cacheKey, cacheKey)

      return stored
    })

    const onState = async () => {
      const stored = core.storeds.get(cacheKey)

      foreground.requestOrThrow<void>({
        method: "brume_update",
        params: [cacheKey, stored]
      }).then(r => r.unwrap()).catch(console.warn)

      return new None()
    }

    core.onState.on(cacheKey, onState, { passive: true })

    foreground.events.on("close", () => {
      core.onState.off(cacheKey, onState)
      return new None()
    })

    return state
  }

  async brume_get_user(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<Nullable<RawState>> {
    const user = Option.unwrap(this.#user)

    const [cacheKey] = (request as RpcRequestPreinit<[string]>).params

    const state = await core.getOrCreateMutex(cacheKey).lock(async () => {
      const cached = core.storeds.get(cacheKey)

      if (cached != null)
        return cached

      const stored = await user.storage.getOrThrow(cacheKey)

      core.storeds.set(cacheKey, stored)
      core.unstoreds.delete(cacheKey)

      await core.onState.emit("*", cacheKey)
      await core.onState.emit(cacheKey, cacheKey)

      return stored
    })

    const onState = async () => {
      const stored = core.storeds.get(cacheKey)

      foreground.requestOrThrow<void>({
        method: "brume_update",
        params: [cacheKey, stored]
      }).then(r => r.unwrap()).catch(console.warn)

      return new None()
    }

    core.onState.on(cacheKey, onState, { passive: true })

    foreground.events.on("close", () => {
      core.onState.off(cacheKey, onState)
      return new None()
    })

    return state
  }

  async brume_set_user(request: RpcRequestPreinit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const [cacheKey, rawState] = (request as RpcRequestPreinit<[string, Nullable<RawState>]>).params

    if (cacheKey.startsWith("session/")) {
      const storage2 = new SessionStorage(user.storage)
      storage2.setOrThrow(cacheKey, rawState as any)
    } else {
      user.storage.setOrThrow(cacheKey, rawState)
    }

    core.storeds.set(cacheKey, rawState)
    core.unstoreds.delete(cacheKey)

    await core.onState.emit("*", cacheKey)
    await core.onState.emit(cacheKey, cacheKey)
  }

  async brume_eth_fetch(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<unknown> {
    const user = Option.unwrap(this.#user)

    const [uuid, chainId, subrequest] = (request as RpcRequestPreinit<[string, number, EthereumQueryKey<unknown> & EthereumFetchParams]>).params

    const chain = Option.unwrap(chainDataByChainId[chainId])
    const brume = await user.getOrTakeEthBrumeOrThrow(uuid)

    const context: BgEthereumContext = { chain, brume }

    return await BgEthereumContext.fetchOrFail<unknown>(context, subrequest).then(r => r.unwrap())
  }

  async routeCustomOrThrow(ethereum: BgEthereumContext, request: RpcRequestPreinit<unknown> & EthereumFetchParams, storage: IDBStorage): Promise<SimpleQuery<any, any, Error>> {
    if (request.method === BgEns.Lookup.method)
      return await BgEns.Lookup.parseOrThrow(ethereum, request, storage)
    if (request.method === BgEns.Reverse.method)
      return await BgEns.Reverse.parseOrThrow(ethereum, request, storage)
    if (request.method === BgSimulation.method)
      return await BgSimulation.parseOrThrow(ethereum, request, storage)

    throw new Error(`Unknown fetcher`)
  }

  async brume_eth_custom_fetch(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<unknown> {
    const user = Option.unwrap(this.#user)

    const [uuid, chainId, subrequest] = (request as RpcRequestPreinit<[string, number, EthereumQueryKey<unknown> & EthereumFetchParams]>).params

    const chain = Option.unwrap(chainDataByChainId[chainId])
    const brume = await user.getOrTakeEthBrumeOrThrow(uuid)

    const ethereum: BgEthereumContext = { chain, brume }

    const query = await this.routeCustomOrThrow(ethereum, subrequest, user.storage)

    try { await query.fetch() } catch { }

    const stored = core.storeds.get(query.cacheKey)
    const unstored = await core.unstoreOrThrow<any, unknown, Error>(stored, { key: query.cacheKey })

    return Option.unwrap(unstored.current).unwrap()
  }

  async brume_log(request: RpcRequestInit<unknown>): Promise<void> {
    const user = Option.unwrap(this.#user)

    const logs = await SettingsQuery.Logs.create(user.storage).state

    if (logs.real?.current?.get() !== true)
      return

    using circuit = await Pool.takeCryptoRandomOrThrow(this.circuits)

    const body = JSON.stringify({ tor: true, method: "eth_getBalance" })

    using stream = await Circuits.openAsOrThrow(circuit, "https://proxy.brume.money")
    await fetch("https://proxy.brume.money", { method: "POST", body, stream: stream.inner })
  }

  async #wcReconnectAllOrThrow(): Promise<void> {
    const user = Option.unwrap(this.#user)

    const persSessionsQuery = BgSession.All.Persistent.schema(user.storage)
    const persSessionsState = await persSessionsQuery.state

    for (const sessionRef of Option.wrap(persSessionsState?.data?.get()).unwrapOr([]))
      this.#wcResolveAndReconnectOrThrow(sessionRef).catch(console.warn)

    return
  }

  async #wcResolveAndReconnectOrThrow(sessionRef: SessionRef): Promise<void> {
    const user = Option.unwrap(this.#user)

    if (user.wcBySession.has(sessionRef.id))
      return

    const sessionQuery = BgSession.schema(sessionRef.id, user.storage)
    const sessionState = await sessionQuery.state
    const sessionDataOpt = Option.wrap(sessionState.data?.get())

    if (sessionDataOpt.isNone())
      return
    if (sessionDataOpt.inner.type !== "wc")
      return

    const sessionData = sessionDataOpt.inner
    const sessionResult = await Result.runAndDoubleWrap(() => this.#wcReconnectOrThrow(sessionData))

    const { id } = sessionRef
    const error = sessionResult.mapErrSync(RpcError.rewrap).err().inner
    await Status.schema(id).mutate(Mutators.data<StatusData, never>({ id, error }))
  }

  async #wcReconnectOrThrow(sessionData: WcSessionData): Promise<WcSession> {
    const user = Option.unwrap(this.#user)

    const { topic, metadata, sessionKeyBase64, authKeyJwk, wallets, settlement } = sessionData

    const firstWalletRef = Option.unwrap(wallets[0])

    const authKey = await Ed25519.get().PrivateKey.importJwkOrThrow(authKeyJwk)

    const brume = await WcBrume.createOrThrow(this.circuits, authKey)
    const irn = new IrnBrume(brume)

    const rawSessionKey = Base64.get().decodePaddedOrThrow(sessionKeyBase64).copyAndDispose()
    const sessionKey = Bytes.castOrThrow(rawSessionKey, 32)
    const sessionClient = CryptoClient.createOrThrow(irn, topic, sessionKey, ping.value * 6)
    const session = new WcSession(sessionClient, metadata)

    await irn.subscribeOrThrow(topic, AbortSignal.timeout(ping.value * 6))

    /**
     * When settlement has been interrupted
     */
    if (settlement != null) {
      await session.client.waitOrThrow<boolean>(settlement)
        .then(r => r.unwrap())
        .then(Result.assert)
        .then(r => r.unwrap())

      const sessionQuery = BgSession.schema(sessionData.id, user.storage)
      await sessionQuery.mutate(Mutators.mapExistingData(d => d.mapSync(x => ({ ...x, settlement: undefined }))))
    }

    const onRequest = async (suprequest: RpcRequestPreinit<unknown>) => {
      if (suprequest.method !== "wc_sessionRequest")
        return new None()
      const { chainId, request } = (suprequest as RpcRequestInit<WcSessionRequestParams>).params

      const chainData = Option.unwrap(chainDataByChainId[Number(chainId.split(":")[1])])

      const brume = await user.getOrTakeEthBrumeOrThrow(firstWalletRef.uuid)

      const ethereum: BgEthereumContext = { chain: chainData, brume }

      if (request.method === "eth_sendTransaction")
        return new Some(await this.eth_sendTransaction(ethereum, sessionData, request))
      if (request.method === "personal_sign")
        return new Some(await this.personal_sign(ethereum, sessionData, request))
      if (request.method === "eth_signTypedData_v4")
        return new Some(await this.eth_signTypedData_v4(ethereum, sessionData, request))
      return new None()
    }

    const onCloseOrError = async () => {
      session.client.events.off("request", onRequest)
      session.client.irn.events.off("close", onCloseOrError)
      session.client.irn.events.off("error", onCloseOrError)
      return new None()
    }

    session.client.events.on("request", onRequest, { passive: true })
    session.client.irn.events.on("close", onCloseOrError, { passive: true })
    session.client.irn.events.on("error", onCloseOrError, { passive: true })

    user.wcBySession.set(sessionData.id, session)

    return session
  }

  async brume_wc_connect(foreground: RpcRouter, request: RpcRequestPreinit<unknown>): Promise<WcMetadata> {
    const user = Option.unwrap(this.#user)

    const [rawWcUrl, walletId] = (request as RpcRequestPreinit<[string, string]>).params

    const walletState = await BgWallet.schema(walletId, user.storage).state
    const walletData = Option.unwrap(walletState.real?.current.ok().get())

    const wcUrl = new URL(rawWcUrl)
    const pairParams = Wc.parseOrThrow(wcUrl)

    const brume = await Pool.takeCryptoRandomOrThrow(this.wcBrumes)
    const irn = new IrnBrume(brume)

    const chains = Objects.values(chainDataByChainId).map(x => x.chainId)
    const metadata = { name: "Brume", description: "Brume", url: location.origin, icons: [] }
    const [session, settlement] = await Wc.pairOrThrow(irn, pairParams, metadata, walletData.address, chains, ping.value * 6)

    const originData: OriginData = {
      origin: `wc://${randomUUID()}`,
      title: session.metadata.name,
      description: session.metadata.description,
    }

    const originQuery = Option.unwrap(OriginQuery.create(originData.origin, user.storage))
    await originQuery.mutate(Mutators.data(originData))

    const authKeyJwk = await irn.brume.key.exportJwkOrThrow()
    const sessionKeyBase64 = Base64.get().encodePaddedOrThrow(session.client.key)

    const sessionData: WcSessionData = {
      type: "wc",
      id: randomUUID(),
      origin: originData.origin,
      metadata: session.metadata,
      persist: true,
      wallets: [WalletRef.from(walletData)],
      relay: Wc.RELAY,
      topic: session.client.topic,
      sessionKeyBase64: sessionKeyBase64,
      authKeyJwk: authKeyJwk,
      settlement: settlement.receipt
    }

    const sessionQuery = BgSession.schema(sessionData.id, user.storage)
    await sessionQuery.mutate(Mutators.data<SessionData, never>(sessionData))

    /**
     * Service worker can die here
     */
    await settlement.promise
      .then(r => r.unwrap())
      .then(Result.assert)
      .then(r => r.unwrap())

    await sessionQuery.mutate(Mutators.mapExistingData(d => d.mapSync(x => ({ ...x, settlement: undefined }))))

    const onRequest = async (suprequest: RpcRequestPreinit<unknown>) => {
      if (suprequest.method !== "wc_sessionRequest")
        return new None()

      const { chainId, request } = (suprequest as RpcRequestInit<WcSessionRequestParams>).params

      const walletState = await BgWallet.schema(walletId, user.storage).state
      const walletData = Option.unwrap(walletState.real?.current.ok().get())

      const chain = Option.unwrap(chainDataByChainId[Number(chainId.split(":")[1])])
      const brume = await user.getOrTakeEthBrumeOrThrow(walletData.uuid)

      const ethereum: BgEthereumContext = { chain, brume }

      if (request.method === "eth_sendTransaction")
        return new Some(await this.eth_sendTransaction(ethereum, sessionData, request))
      if (request.method === "personal_sign")
        return new Some(await this.personal_sign(ethereum, sessionData, request))
      if (request.method === "eth_signTypedData_v4")
        return new Some(await this.eth_signTypedData_v4(ethereum, sessionData, request))
      return new None()
    }

    const onCloseOrError = async () => {
      session.client.events.off("request", onRequest)
      session.client.irn.events.off("close", onCloseOrError)
      session.client.irn.events.off("error", onCloseOrError)
      return new None()
    }

    session.client.events.on("request", onRequest, { passive: true })
    session.client.irn.events.on("close", onCloseOrError, { passive: true })
    session.client.irn.events.on("error", onCloseOrError, { passive: true })

    user.wcBySession.set(sessionData.id, session)

    const { id } = sessionData
    await Status.schema(id).mutate(Mutators.data<StatusData, never>({ id }))

    const icons = session.metadata.icons.map<BlobbyRef>(x => ({ ref: true, id: x }))
    await originQuery.mutate(Mutators.mapExistingData(d => d.mapSync(x => ({ ...x, icons }))))

    for (const iconUrl of session.metadata.icons) {
      (async () => {
        using circuit = await Pool.takeCryptoRandomOrThrow(this.circuits)

        console.debug(`Fetching ${iconUrl} with ${circuit.id}`)

        using stream = await Circuits.openAsOrThrow(circuit, iconUrl)
        const iconRes = await fetch(iconUrl, { stream: stream.inner })
        const iconBlob = await iconRes.blob()

        if (!Mime.isImage(iconBlob.type))
          throw new Error()

        const iconData = await Blobs.readAsDataUrlOrThrow(iconBlob)

        const blobbyQuery = Option.unwrap(BlobbyQuery.create(iconUrl, user.storage))
        const blobbyData = { id: iconUrl, data: iconData }
        await blobbyQuery.mutate(Mutators.data(blobbyData))
      })().catch(console.warn)
    }

    return session.metadata
  }

}

export interface UserSessionParams {
  readonly user: User,
  readonly storage: IDBStorage,
  readonly hasher: HmacEncoder,
  readonly crypter: AesGcmCoder
}

export class UserSession {

  readonly ethBrumeByUuid = new Mutex(new Map<string, EthBrume>())

  readonly scriptsBySession = new Map<string, Set<RpcRouter>>()
  readonly sessionByScript = new Map<string, Mutex<Slot<string>>>()

  readonly wcBySession = new Map<string, WcSession>()

  constructor(
    readonly global: Global,
    readonly user: User,
    readonly storage: IDBStorage,
    readonly hasher: HmacEncoder,
    readonly crypter: AesGcmCoder
  ) { }

  static create(global: Global, params: UserSessionParams) {
    const { user, storage, hasher, crypter } = params
    return new UserSession(global, user, storage, hasher, crypter)
  }

  async getOrTakeEthBrumeOrThrow(uuid: string): Promise<EthBrume> {
    return await this.ethBrumeByUuid.lock(async ethBrumeByUuid => {
      const prev = ethBrumeByUuid.get(uuid)

      if (prev != null)
        return prev

      const next = await Pool.takeCryptoRandomOrThrow(this.global.ethBrumes)

      ethBrumeByUuid.set(uuid, next)

      return next
    })
  }


}

async function initBerith() {
  Ed25519.set(await Ed25519.fromSafeOrBerith())
  X25519.set(await X25519.fromSafeOrBerith())
}

async function initEligos() {
  Secp256k1.set(await Secp256k1.fromEligos())
}

async function initMorax() {
  Keccak256.set(await Keccak256.fromMorax())
  Sha1.set(await Sha1.fromMorax())
  Ripemd160.set(await Ripemd160.fromMorax())
}

async function initAlocer() {
  Base16.set(await Base16.fromBufferOrAlocer())
  Base64.set(await Base64.fromBufferOrAlocer())
  Base64Url.set(await Base64Url.fromBufferOrAlocer())
  Base58.set(await Base58.fromAlocer())
}

async function initZepar() {
  ChaCha20Poly1305.set(await ChaCha20Poly1305.fromZepar())
}

const init = Result.runAndDoubleWrap(() => initOrThrow())

async function initOrThrow() {
  await Promise.all([initBerith(), initEligos(), initMorax(), initAlocer(), initZepar()])

  const gt = globalThis as any
  gt.Console = Console
  gt.Echalote = Echalote
  gt.Cadenas = Cadenas
  gt.Fleche = Fleche
  gt.Kcp = Kcp
  gt.Smux = Smux

  const start = Date.now()

  const storage = IDBStorage.createOrThrow({ name: "memory" })
  const global = new Global(storage)

  console.debug(`Started in ${Date.now() - start}ms`)

  return global
}

if (isWebsite() || isAndroidApp()) {
  const onForeground = async (event: ExtendableMessageEvent) => {
    const port = event.ports[0]

    const name = `foreground-${randomUUID().slice(0, 8)}`
    const router = new MessageRpcRouter(name, port)

    const onRequest = async (request: RpcRequestInit<unknown>) => {
      const inited = await init

      if (inited.isErr())
        return new Some(inited)

      return await inited.get().routeForegroundOrThrow(router, request)
    }

    router.events.on("request", onRequest, { passive: true })

    const onClose = () => {
      using _ = router

      router.events.off("request", onRequest)
      router.port.close()

      return new None()
    }

    router.events.on("close", onClose, { passive: true })

    port.start()

    await router.waitHelloOrThrow(AbortSignal.timeout(1000))

    router.runPingLoop()
  }

  self.addEventListener("message", (event) => {
    if (event.origin !== location.origin)
      return
    if (event.data === "FOREGROUND->BACKGROUND")
      return void onForeground(event)
    return
  })
}

if (isAppleApp()) {
  const onForeground = async (event: ExtendableMessageEvent) => {
    const port = event.ports[0]

    const name = `foreground-${randomUUID().slice(0, 8)}`
    const router = new MessageRpcRouter(name, port)

    const onRequest = async (request: RpcRequestInit<unknown>) => {
      const inited = await init

      if (inited.isErr())
        return new Some(inited)

      return await inited.get().routeForegroundOrThrow(router, request)
    }

    router.events.on("request", onRequest, { passive: true })

    const onClose = () => {
      using _ = router

      router.events.off("request", onRequest)
      router.port.close()

      return new None()
    }

    router.events.on("close", onClose, { passive: true })

    port.start()

    await router.waitHelloOrThrow(AbortSignal.timeout(1000))

    router.runPingLoop()
  }

  self.addEventListener("message", (event) => {
    if (event.origin !== location.origin)
      return
    if (event.data === "FOREGROUND->BACKGROUND")
      return void onForeground(event)
    return
  })
}

if (isExtension()) {
  const onContentScript = async (port: chrome.runtime.Port) => {
    const name = `content_script-${randomUUID().slice(0, 8)}`
    const router = new ExtensionRpcRouter(name, port)

    router.events.on("request", async (request) => {
      const inited = await init

      if (inited.isErr())
        return new Some(inited)

      return await inited.get().routeContentScriptOrThrow(router, request)
    })

    try {
      await router.waitHelloOrThrow(AbortSignal.timeout(1000))
    } catch (e: unknown) {
      console.warn(`Could not connect to content-script`)
      port.disconnect()
    }
  }

  const onForeground = async (port: chrome.runtime.Port) => {
    const name = `foreground-${randomUUID().slice(0, 8)}`
    const router = new ExtensionRpcRouter(name, port)

    router.events.on("request", async (request) => {
      const inited = await init

      if (inited.isErr())
        return new Some(inited)

      return await inited.get().routeForegroundOrThrow(router, request)
    })

    try {
      await router.waitHelloOrThrow(AbortSignal.timeout(1000))
    } catch (e: unknown) {
      console.warn(`Could not connect to foreground`)
      port.disconnect()
    }
  }

  const onOffscreen = async (port: chrome.runtime.Port) => {
    const name = `offscreen-${randomUUID().slice(0, 8)}`
    const router = new ExtensionRpcRouter(name, port)

    console.debug(name, "connected")

    try {
      await router.waitHelloOrThrow(AbortSignal.timeout(1000))
    } catch (e: unknown) {
      console.warn(`Could not connect to offscreen`)
      port.disconnect()
    }
  }

  browser.runtime.onConnect.addListener(port => {
    if (port.sender?.id !== browser.runtime.id)
      return
    if (port.name === "foreground->background")
      return void onForeground(port)
    if (port.name === "content_script->background")
      return void onContentScript(port)
    if (port.name === "offscreen->background")
      return void onOffscreen(port)
    return
  })

  if (isChromeExtension()) {
    try {
      const url = "/offscreen.html"
      const reasons = [chrome.offscreen.Reason.WORKERS]
      const justification = "We need to run workers"

      await BrowserError.runOrThrow(() => browser.offscreen.createDocument({ url, reasons, justification }))
    } catch (e: unknown) {
      console.warn(`Could not create offscreen document`, e)
    }

    browser.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
      const inited = await init

      if (inited.isErr())
        return

      const window = await BrowserError.runOrThrow(() => browser.windows.getCurrent())

      if (window.width == null)
        return
      if (window.height == null)
        return
      if (window.left == null)
        return
      if (window.top == null)
        return

      const x = window.left + window.width - 220
      const y = window.top + 360

      await inited.get().openOrFocusPopupOrThrow("/", { x, y })
    })
  }

  if (isFirefoxExtension()) {
    browser.browserAction.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
      const inited = await init

      if (inited.isErr())
        return

      const window = await BrowserError.runOrThrow(() => browser.windows.getCurrent())

      if (window.width == null)
        return
      if (window.height == null)
        return
      if (window.left == null)
        return
      if (window.top == null)
        return

      const x = window.left + window.width - 220
      const y = window.top + 360

      await inited.get().openOrFocusPopupOrThrow("/", { x, y })
    })
  }

  if (isSafariExtension() && isIpad()) {
    browser.browserAction.setPopup({ popup: "action.html" })
  }

  if (isSafariExtension() && !isIpad()) {
    browser.browserAction.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
      const inited = await init

      if (inited.isErr())
        return

      const window = await BrowserError.runOrThrow(() => browser.windows.getCurrent())

      if (window.width == null)
        return
      if (window.height == null)
        return
      if (window.left == null)
        return
      if (window.top == null)
        return

      const x = window.left + 220
      const y = window.top + 360

      await inited.get().openOrFocusPopupOrThrow("/", { x, y })
    })
  }
}