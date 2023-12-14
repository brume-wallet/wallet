import { ChainData } from "@/libs/ethereum/mods/chain"
import { RpcReceipt } from "@/libs/wconn/mods/crypto/client"
import { WcMetadata } from "@/libs/wconn/mods/wc/wc"
import { Mutators } from "@/libs/xswr/mutators"
import { Ed25519 } from "@hazae41/ed25519"
import { Data, IDBStorage, RawState2, States, Storage, createQuery } from "@hazae41/glacier"
import { Nullable } from "@hazae41/option"
import { Wallet } from "../wallets/data"
import { PersistentSessions, PersistentSessionsByWallet, TemporarySessions, TemporarySessionsByWallet } from "./all/data"

export type Session =
  | SessionData
  | SessionRef

export interface SessionRef {
  readonly ref: true
  readonly id: string
  readonly origin: string
}

export namespace SessionRef {

  export function from(session: Session): SessionRef {
    return { ref: true, id: session.id, origin: session.origin }
  }

}

export type SessionData =
  | ExSessionData
  | WcSessionData

export interface ExSessionData {
  readonly id: string,
  readonly type?: "ex"
  readonly origin: string
  readonly persist: boolean
  readonly chain: ChainData
  readonly wallets: Wallet[]
}

export interface WcSessionData {
  readonly id: string,
  readonly type: "wc"
  readonly origin: string
  readonly persist: true
  readonly chain: ChainData
  readonly wallets: [Wallet]
  readonly metadata: WcMetadata
  readonly relay: string
  readonly topic: string
  readonly sessionKeyBase64: string
  readonly authKeyJwk: Ed25519.PrivateKeyJwk,
  readonly settlement?: RpcReceipt
}

export class SessionStorage implements Storage {

  constructor(
    readonly storage: IDBStorage
  ) { }

  getOrThrow(cacheKey: string) {
    return this.storage.getOrThrow(cacheKey)
  }

  setOrThrow(cacheKey: string, value: Nullable<RawState2<SessionData>>) {
    if (value?.data?.data.persist === false)
      return
    return this.storage.setOrThrow(cacheKey, value)
  }

}

export namespace Session {

  export type Key = ReturnType<typeof key>

  export function key(id: string) {
    return `session/v4/${id}`
  }

  export type Schema = ReturnType<typeof schema>

  export function schema(id: string, storage: IDBStorage) {
    const indexer = async (states: States<SessionData, never>) => {
      const { current, previous = current } = states

      const previousData = previous.real?.data
      const currentData = current.real?.data

      if (previousData != null) {
        if (previousData.inner.persist) {
          const sessionByOrigin = SessionByOrigin.schema(previousData.inner.origin, storage)
          await sessionByOrigin.delete()
        }

        const sessionsQuery = previousData.inner.persist
          ? PersistentSessions.schema(storage)
          : TemporarySessions.schema()

        await sessionsQuery.mutate(Mutators.mapData((d = new Data([])) => {
          return d.mapSync(p => p.filter(x => x.id !== previousData.inner.id))
        }))

        const previousWallets = new Set(previousData.inner.wallets)

        for (const wallet of previousWallets) {
          const sessionsByWalletQuery = previousData.inner.persist
            ? PersistentSessionsByWallet.schema(wallet.uuid, storage)
            : TemporarySessionsByWallet.schema(wallet.uuid)

          await sessionsByWalletQuery.mutate(Mutators.mapData((d = new Data([])) => {
            return d.mapSync(p => p.filter(x => x.id !== previousData.inner.id))
          }))
        }
      }

      if (currentData != null) {
        if (currentData.inner.persist) {
          const sessionByOrigin = SessionByOrigin.schema(currentData.inner.origin, storage)
          await sessionByOrigin.mutate(Mutators.data(SessionRef.from(currentData.inner)))
        }

        const sessionsQuery = currentData.inner.persist
          ? PersistentSessions.schema(storage)
          : TemporarySessions.schema()

        await sessionsQuery.mutate(Mutators.mapData((d = new Data([])) => {
          return d = d.mapSync(p => [...p, SessionRef.from(currentData.inner)])
        }))

        const currentWallets = new Set(currentData.inner.wallets)

        for (const wallet of currentWallets) {
          const sessionsByWalletQuery = currentData.inner.persist
            ? PersistentSessionsByWallet.schema(wallet.uuid, storage)
            : TemporarySessionsByWallet.schema(wallet.uuid)

          await sessionsByWalletQuery.mutate(Mutators.mapData((d = new Data([])) => {
            return d.mapSync(p => [...p, SessionRef.from(currentData.inner)])
          }))
        }
      }
    }

    return createQuery<Key, SessionData, never>({ key: key(id), indexer, storage: new SessionStorage(storage) })
  }

}

export namespace SessionByOrigin {

  export type Key = ReturnType<typeof key>

  export function key(origin: string) {
    return `sessionByOrigin/${origin}`
  }

  export type Schema = ReturnType<typeof schema>

  export function schema(origin: string, storage: IDBStorage) {
    return createQuery<Key, SessionRef, never>({ key: key(origin), storage })
  }

}