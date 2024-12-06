import { Outline } from "@/libs/icons/icons";
import { Dialog } from "@/libs/ui/dialog";
import { AnchorShrinkerDiv, AnchorShrinkerUnflexDiv } from "@/libs/ui/shrinker";
import { HashSubpathProvider, PathHandle, useCoords, useHashSubpath, usePathContext } from "@hazae41/chemin";
import { useAppRequests } from "../entities/requests/data";

export function Omnidialog(props: {
  readonly path: PathHandle
}) {
  const { path } = props

  const requestsQuery = useAppRequests()
  const requests = requestsQuery.data?.get()

  return <Dialog>
    <div className="flex items-center po-md bg-contrast rounded-xl">
      <Outline.SparklesIcon className="size-4" />
      <div className="w-2" />
      <input className="w-full bg-transparent outline-none"
        placeholder="tell me what you want" />
    </div>
    <div className="h-4" />
    <div className="font-medium">
      User
    </div>
    <div className="h-4" />
    <div className="grid place-content-start gap-2 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/home"}
        href="#/home">
        <Outline.HomeIcon className="size-5" />
        <div className="h-4" />
        Home
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/wallets"}
        href="#/wallets">
        <Outline.WalletIcon className="size-5" />
        <div className="h-4" />
        Wallets
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/seeds"}
        href="#/seeds">
        <Outline.SparklesIcon className="size-5" />
        <div className="h-4" />
        Seeds
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/sessions"}
        href="#/sessions">
        <Outline.GlobeAltIcon className="size-5" />
        <div className="h-4" />
        Sessions
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/requests"}
        href="#/requests">
        <AnchorShrinkerUnflexDiv>
          <div className="relative">
            {Boolean(requests?.length) &&
              <div className="absolute top-0 -right-2">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                  <span className="relative inline-flex rounded-full w-2 h-2 bg-purple-400" />
                </span>
              </div>}
            <Outline.CheckIcon className="size-5" />
          </div>
          <div className="h-4" />
          Requests
        </AnchorShrinkerUnflexDiv>
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/settings"}
        href="#/settings">
        <Outline.CogIcon className="size-5" />
        <div className="h-4" />
        Settings
      </a>
    </div>
    <div className="h-4" />
    <div className="font-medium">
      General
    </div>
    <div className="h-4" />
    <div className="grid place-content-start gap-2 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/settings"}
        href="#/settings">
        <Outline.HomeIcon className="size-5" />
        <div className="h-4" />
        Home
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/apps"}
        href="#/apps">
        <Outline.GlobeAltIcon className="size-5" />
        <div className="h-4" />
        Apps
      </a>
      <a className="po-md bg-contrast rounded-xl"
        data-selected={path.url.pathname === "/settings"}
        href="#/settings">
        <Outline.CogIcon className="size-5" />
        <div className="h-4" />
        Settings
      </a>
    </div>
  </Dialog>
}

export function Bottom() {
  const path = usePathContext().getOrThrow()
  const subpath = useHashSubpath(path)

  const requestsQuery = useAppRequests()
  const requests = requestsQuery.data?.get()

  const omnidialog = useCoords(subpath, "/...")

  return <nav className="h-16 w-full flex-none border-t border-t-contrast">
    <HashSubpathProvider>
      {subpath.url.pathname === "/..." &&
        <Omnidialog path={path} />}
    </HashSubpathProvider>
    <div className="w-full h-16 px-4 m-auto max-w-3xl flex items-center">
      <a className={`group flex-1 text-contrast data-[selected=true]:text-default`}
        data-selected={path.url.pathname === "/home"}
        href="#/home">
        <AnchorShrinkerDiv>
          <Outline.HomeIcon className="size-6" />
        </AnchorShrinkerDiv>
      </a>
      <a className={`group flex-1 text-contrast data-[selected=true]:text-default`}
        data-selected={path.url.pathname === "/wallets"}
        href="#/wallets">
        <AnchorShrinkerDiv>
          <Outline.WalletIcon className="size-6" />
        </AnchorShrinkerDiv>
      </a>
      <a className={`group flex-1 text-contrast data-[selected=true]:text-default`}
        data-selected={path.url.pathname === "/seeds"}
        href="#/seeds">
        <AnchorShrinkerDiv>
          <Outline.SparklesIcon className="size-6" />
        </AnchorShrinkerDiv>
      </a>
      <div className="flex-1 flex items-center justify-center">
        <a className="group po-md bg-opposite rounded-full text-opposite"
          href={omnidialog.href}
          onClick={omnidialog.onClick}
          onKeyDown={omnidialog.onKeyDown}>
          <AnchorShrinkerDiv>
            <Outline.EllipsisHorizontalIcon className="size-6" />
          </AnchorShrinkerDiv>
        </a>
      </div>
      <a className="group flex-1 text-contrast data-[selected=true]:text-default"
        data-selected={path.url.pathname === "/sessions"}
        href="#/sessions">
        <AnchorShrinkerDiv>
          <Outline.GlobeAltIcon className="size-6" />
        </AnchorShrinkerDiv>
      </a>
      <a className="group flex-1 text-contrast data-[selected=true]:text-default"
        data-selected={path.url.pathname === "/requests"}
        href="#/requests">
        <AnchorShrinkerDiv>
          <div className="relative">
            {Boolean(requests?.length) &&
              <div className="absolute top-0 -right-2">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                  <span className="relative inline-flex rounded-full w-2 h-2 bg-purple-400" />
                </span>
              </div>}
            <Outline.CheckIcon className="size-6" />
          </div>
        </AnchorShrinkerDiv>
      </a>
      <a className="group flex-1 text-contrast data-[selected=true]:text-default"
        data-selected={path.url.pathname === "/settings"}
        href="#/settings">
        <AnchorShrinkerDiv>
          <Outline.CogIcon className="size-6" />
        </AnchorShrinkerDiv>
      </a>
    </div>
  </nav>
}