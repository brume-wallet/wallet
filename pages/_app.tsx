import { Catcher } from "@/libs/react/error"
import { ErrorProps } from "@/libs/react/props/error"
import { Overlay } from "@/mods/overlay/overlay"
import { StorageProvider } from "@/mods/storage/context"
import { CircuitsProvider } from "@/mods/tor/circuits/context"
import { TorProvider } from "@/mods/tor/context"
import { SessionsProvider } from "@/mods/tor/sessions/context"
import '@/styles/globals.css'
import { CoreProvider } from "@hazae41/xswr"
import type { AppProps } from 'next/app'
import Head from "next/head"

export function Fallback(props: ErrorProps) {
  const { error } = props

  return <>An error occured</>
}

export default function App({ Component, pageProps }: AppProps) {
  return <Catcher fallback={Fallback}>
    <CoreProvider>
      <StorageProvider>
        <TorProvider>
          <CircuitsProvider>
            <SessionsProvider>
              <Head>
                <title>Brume Wallet</title>
                <meta key="application-name" name="application-name" content="Brume Wallet" />
                <meta key="description" name="description" content="The first private Ethereum wallet with built-in Tor" />
                <meta key="color-scheme" name="color-scheme" content="dark light" />
                <meta key="viewport" name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
                <meta key="apple-mobile-web-app-capable" name="apple-mobile-web-app-capable" content="yes" />
                <meta key="apple-mobile-web-app-status-bar-style" name="apple-mobile-web-app-status-bar-style" content="white" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <link rel="alternate icon" href="/favicon.ico" />
                <link rel="manifest" href="/manifest.json" />
                <link rel="apple-touch-icon" href="/square.png" />
                <link rel="apple-touch-startup-image" href="/round.png" />
              </Head>
              <Overlay>
                <Component {...pageProps} />
              </Overlay>
            </SessionsProvider>
          </CircuitsProvider>
        </TorProvider>
      </StorageProvider>
    </CoreProvider>
  </Catcher>
}
