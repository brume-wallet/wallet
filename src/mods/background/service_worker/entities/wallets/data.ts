import { Fixed, ZeroHexString } from "@hazae41/cubane"
import { Data, QueryStorage, States, createQuery } from "@hazae41/glacier"
import { RpcRequestPreinit } from "@hazae41/jsonrpc"
import { None, Some } from "@hazae41/option"
import { SeedRef } from "../../../../universal/entities/seeds/data"
import { BgTotal } from "../unknown/data"

export type Wallet =
  | WalletRef
  | WalletData

export interface WalletProps {
  readonly wallet: Wallet
}

export interface WalletDataProps {
  readonly wallet: WalletData
}

export interface WalletRef {
  readonly ref: true
  readonly uuid: string
}

export namespace WalletRef {

  export function create(uuid: string): WalletRef {
    return { ref: true, uuid }
  }

  export function from(wallet: Wallet): WalletRef {
    return create(wallet.uuid)
  }

}

export type WalletData =
  | EthereumWalletData

export type EthereumWalletData =
  | EthereumReadonlyWalletData
  | EthereumSignableWalletData

export type EthereumSignableWalletData =
  | EthereumPrivateKeyWalletData
  | EthereumSeededWalletData

export type EthereumPrivateKeyWalletData =
  | EthereumUnauthPrivateKeyWalletData
  | EthereumAuthPrivateKeyWalletData

export function getWalletEmoji(type: WalletData["type"]): string {
  if (type === "seeded")
    return "🌱"
  if (type === "readonly")
    return "👀"
  if (type === "privateKey")
    return "🔑"
  if (type === "authPrivateKey")
    return "🔐"
  return type satisfies never
}

export interface EthereumReadonlyWalletData {
  readonly coin: "ethereum"
  readonly type: "readonly"

  readonly uuid: string
  readonly name: string,
  readonly color: number,

  readonly address: ZeroHexString

  readonly trashed?: boolean
}

export interface EthereumUnauthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "privateKey"

  readonly uuid: string
  readonly name: string,
  readonly color: number,

  readonly address: ZeroHexString

  readonly privateKey: ZeroHexString

  readonly trashed?: boolean
}

export interface EthereumAuthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "authPrivateKey"

  readonly uuid: string
  readonly name: string,
  readonly color: number,

  readonly address: ZeroHexString

  readonly privateKey: {
    readonly ivBase64: string,
    readonly idBase64: string
  }

  readonly trashed?: boolean
}

export interface EthereumSeededWalletData {
  readonly coin: "ethereum"
  readonly type: "seeded"

  readonly uuid: string
  readonly name: string,
  readonly color: number,

  readonly address: ZeroHexString

  readonly seed: SeedRef
  readonly path: string

  readonly trashed?: boolean
}

export namespace BgWallet {

  export namespace All {

    export namespace Trashed {

      export type K = string
      export type D = Wallet[]
      export type F = never

      export const key = `trashedWallets`

      export type Schema = ReturnType<typeof schema>

      export function schema(storage: QueryStorage) {
        return createQuery<K, D, F>({ key, storage })
      }

    }

    export namespace BySeed {

      export type K = string
      export type D = Wallet[]
      export type F = never

      export function key(uuid: string) {
        return `walletsBySeed/${uuid}`
      }

      export function schema(uuid: string, storage: QueryStorage) {
        return createQuery<K, D, F>({ key: key(uuid), storage })
      }

    }

    export namespace ByAddress {

      export type K = string
      export type D = Wallet[]
      export type F = never

      export function key(address: string) {
        return `walletsByAddress/${address}`
      }

      export function schema(account: ZeroHexString, storage: QueryStorage) {
        const indexer = async (states: States<D, F>) => {
          const { current, previous } = states

          const previousData = previous?.real?.current.ok()?.getOrNull()
          const currentData = current.real?.current.ok()?.getOrNull()

          const [array = []] = [currentData]

          await BgTotal.Balance.Priced.ByAddress.Record.schema("usd", storage).mutate(s => {
            const current = s.current

            const [{ value = new Fixed(0n, 0) } = {}] = [current?.ok().getOrNull()?.[account]]

            const inner = { value, count: array.length }

            if (current == null)
              return new Some(new Data({ [account]: inner }))
            if (current.isErr())
              return new None()

            return new Some(current.mapSync(c => ({ ...c, [account]: inner })))
          })
        }

        return createQuery<K, D, F>({
          key: key(account),
          indexer,
          storage
        })
      }

    }

    export type K = string
    export type D = Wallet[]
    export type F = never

    export const key = `wallets`

    export type Schema = ReturnType<typeof schema>

    export function schema(storage: QueryStorage) {
      return createQuery<K, D, F>({ key, storage })
    }

  }

  export type K = string
  export type D = WalletData
  export type F = never

  export function key(uuid: string) {
    return `wallet/${uuid}`
  }

  export function schema(uuid: string, storage: QueryStorage) {
    const indexer = async (states: States<D, F>) => {
      const { current, previous } = states

      const previousData = previous?.real?.current.ok()?.getOrNull()
      const currentData = current.real?.current.ok()?.getOrNull()

      if (previousData != null && (previousData.uuid !== currentData?.uuid || previousData.trashed !== currentData?.trashed) && !previousData.trashed) {
        await All.schema(storage).mutate(s => {
          const current = s.current

          if (current == null)
            return new None()
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => p.filter(x => x.uuid !== previousData.uuid)))
        })

        await All.ByAddress.schema(previousData.address, storage)?.mutate(s => {
          const current = s.current

          if (current == null)
            return new None()
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => p.filter(x => x.uuid !== previousData.uuid)))
        })

        if (previousData.type === "seeded") {
          const { seed } = previousData

          await All.BySeed.schema(seed.uuid, storage)?.mutate(s => {
            const current = s.current

            if (current == null)
              return new None()
            if (current.isErr())
              return new None()

            return new Some(current.mapSync(p => p.filter(x => x.uuid !== previousData.uuid)))
          })
        }
      }

      if (previousData != null && (previousData.uuid !== currentData?.uuid || previousData.trashed !== currentData?.trashed) && previousData.trashed) {
        await All.Trashed.schema(storage).mutate(s => {
          const current = s.current

          if (current == null)
            return new None()
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => p.filter(x => x.uuid !== previousData.uuid)))
        })
      }

      if (currentData != null && (currentData.uuid !== previousData?.uuid || currentData.trashed !== previousData?.trashed) && !currentData.trashed) {
        await All.schema(storage).mutate(s => {
          const current = s.current

          if (current == null)
            return new Some(new Data([WalletRef.from(currentData)]))
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => [...p, WalletRef.from(currentData)]))
        })

        await All.ByAddress.schema(currentData.address, storage)?.mutate(s => {
          const current = s.current

          if (current == null)
            return new Some(new Data([WalletRef.from(currentData)]))
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => [...p, WalletRef.from(currentData)]))
        })

        if (currentData.type === "seeded") {
          const { seed } = currentData

          await All.BySeed.schema(seed.uuid, storage)?.mutate(s => {
            const current = s.current

            if (current == null)
              return new Some(new Data([WalletRef.from(currentData)]))
            if (current.isErr())
              return new None()

            return new Some(current.mapSync(p => [...p, WalletRef.from(currentData)]))
          })
        }
      }

      if (currentData != null && (currentData.uuid !== previousData?.uuid || currentData.trashed !== previousData?.trashed) && currentData.trashed) {
        await All.Trashed.schema(storage).mutate(s => {
          const current = s.current

          if (current == null)
            return new Some(new Data([WalletRef.from(currentData)]))
          if (current.isErr())
            return new None()

          return new Some(current.mapSync(p => [...p, WalletRef.from(currentData)]))
        })
      }
    }

    return createQuery<K, D, F>({ key: key(uuid), indexer, storage })
  }

}

export type EthereumQueryKey<T> = RpcRequestPreinit<T> & {
  [key: string]: unknown
  chainId: number
}

export interface EthereumFetchParams {
  noCheck?: boolean
}