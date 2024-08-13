import { BrowserError, browser } from "@/libs/browser/browser"
import { Errors } from "@/libs/errors/errors"
import { Outline } from "@/libs/icons/icons"
import { useAsyncUniqueCallback } from "@/libs/react/callback"
import { pathOf } from "@/libs/url/url"
import { usePathContext } from "@hazae41/chemin"
import { RoundedShrinkableNakedButton } from "../entities/wallets/actions/send"

export function NavBar() {
  const path = usePathContext().unwrap()

  const openOrAlert = useAsyncUniqueCallback(() => Errors.runAndLogAndAlert(async () => {
    await BrowserError.runOrThrow(() => browser.tabs.create({ url: `index.html#/?_=${encodeURIComponent(pathOf(path.url))}` }))
  }), [path])

  return <div className="w-full po-md border-b border-b-contrast flex items-center">
    <div className="bg-contrast rounded-xl po-sm grow flex items-center min-w-0">
      <div className="grow whitespace-nowrap overflow-hidden text-ellipsis text-sm">
        <span className="text-contrast">
          {`brume://`}
        </span>
        <span>
          {pathOf(path.url).slice(1)}
        </span>
      </div>
      <div className="w-2" />
      <RoundedShrinkableNakedButton
        onClick={openOrAlert.run}>
        <Outline.ArrowTopRightOnSquareIcon className="size-4 text-contrast" />
      </RoundedShrinkableNakedButton>
    </div>
  </div>
}