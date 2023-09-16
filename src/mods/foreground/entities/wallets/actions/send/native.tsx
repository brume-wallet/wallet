import { BigInts } from "@/libs/bigints/bigints";
import { UIError } from "@/libs/errors/errors";
import { Radix } from "@/libs/hex/hex";
import { Outline } from "@/libs/icons/icons";
import { ExternalDivisionLink } from "@/libs/next/anchor";
import { useAsyncUniqueCallback } from "@/libs/react/callback";
import { useInputChange } from "@/libs/react/events";
import { CloseProps } from "@/libs/react/props/close";
import { TitleProps } from "@/libs/react/props/title";
import { Results } from "@/libs/results/results";
import { Button } from "@/libs/ui/button";
import { Dialog } from "@/libs/ui/dialog/dialog";
import { Input } from "@/libs/ui/input";
import { Option } from "@hazae41/option";
import { Ok, Result } from "@hazae41/result";
import { useCore } from "@hazae41/xswr";
import { Transaction, ethers } from "ethers";
import { useDeferredValue, useMemo, useState } from "react";
import { useWalletData } from "../../context";
import { EthereumContextProps, EthereumWalletInstance, useBalance, useGasPrice, useNonce } from "../../data";

export function WalletDataSendNativeTokenDialog(props: TitleProps & CloseProps & EthereumContextProps) {
  const core = useCore().unwrap()
  const wallet = useWalletData()
  const { title, context, close } = props

  const balanceQuery = useBalance(wallet.address, context, [])
  const maybeBalance = balanceQuery.data?.inner

  const nonceQuery = useNonce(wallet.address, context)
  const maybeNonce = nonceQuery.data?.inner

  const gasPriceQuery = useGasPrice(context)
  const maybeGasPrice = gasPriceQuery.data?.inner

  const [rawRecipientInput = "", setRawRecipientInput] = useState<string>()

  const defRecipientInput = useDeferredValue(rawRecipientInput)

  const onRecipientInputChange = useInputChange(e => {
    setRawRecipientInput(e.currentTarget.value)
  }, [])

  const RecipientInput = <>
    <div className="">
      Recipient
    </div>
    <div className="h-2" />
    <Input.Contrast className="w-full"
      value={rawRecipientInput}
      placeholder="0x..."
      onChange={onRecipientInputChange} />
  </>

  const [rawValueInput = "", setRawValueInput] = useState<string>()

  const defValueInput = useDeferredValue(rawValueInput)

  const onValueInputChange = useInputChange(e => {
    const value = e.currentTarget.value
      .replaceAll(/[^\d.,]/g, "")
      .replaceAll(",", ".")
    setRawValueInput(value)
  }, [])

  const ValueInput = <>
    <div className="">
      Value ({context.chain.token.symbol})
    </div>
    <div className="h-2" />
    <Input.Contrast className="w-full"
      value={rawValueInput}
      placeholder="1.0"
      onChange={onValueInputChange} />
  </>

  const [rawNonceInput = "", setRawNonceInput] = useState<string>()

  const defNonceInput = useDeferredValue(rawNonceInput)

  const onNonceInputChange = useInputChange(e => {
    setRawNonceInput(e.currentTarget.value)
  }, [])

  const maybeFinalNonce = useMemo(() => {
    return BigInts.tryParseInput(defNonceInput).ok().unwrapOr(maybeNonce)
  }, [defNonceInput, maybeNonce])

  const NonceInput = <>
    <div className="">
      Custom nonce
    </div>
    <div className="h-2" />
    <Input.Contrast className="w-full"
      value={rawNonceInput}
      onChange={onNonceInputChange} />
  </>

  const [txHash, setTxHash] = useState<string>()

  const trySend = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const gasPrice = Option.wrap(maybeGasPrice).okOrElseSync(() => {
        return new UIError(`Could not fetch gas price`)
      }).throw(t)

      const nonce = Option.wrap(maybeFinalNonce).okOrElseSync(() => {
        return new UIError(`Could not fetch or parse nonce`)
      }).throw(t)

      const gas = await context.background.tryRequest<string>({
        method: "brume_eth_fetch",
        params: [context.wallet.uuid, context.chain.chainId, {
          method: "eth_estimateGas",
          params: [{
            chainId: Radix.toZeroHex(context.chain.chainId),
            from: wallet.address,
            to: ethers.getAddress(defRecipientInput),
            gasPrice: Radix.toZeroHex(gasPrice),
            value: Radix.toZeroHex(ethers.parseUnits(defValueInput, 18)),
            nonce: Radix.toZeroHex(nonce)
          }, "latest"]
        }]
      }).then(r => r.throw(t).throw(t))

      const tx = Result.runAndDoubleWrapSync(() => {
        return Transaction.from({
          to: ethers.getAddress(defRecipientInput),
          gasLimit: gas,
          chainId: context.chain.chainId,
          gasPrice: gasPrice,
          nonce: Number(nonce),
          value: ethers.parseUnits(defValueInput, 18)
        })
      }).throw(t)

      const instance = await EthereumWalletInstance.tryFrom(wallet, core, context.background).then(r => r.throw(t))
      tx.signature = await instance.trySignTransaction(tx, core, context.background).then(r => r.throw(t))

      const txHash = await context.background.tryRequest<string>({
        method: "brume_eth_fetch",
        params: [context.wallet.uuid, context.chain.chainId, {
          method: "eth_sendRawTransaction",
          params: [tx.serialized]
        }]
      }).then(r => r.throw(t).throw(t))

      setTxHash(txHash)

      balanceQuery.refetch()
      nonceQuery.refetch()

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [core, context, wallet, maybeGasPrice, maybeFinalNonce, defRecipientInput, defValueInput])

  const TxHashDisplay = <>
    <div className="">
      Transaction hash
    </div>
    <div className="text-contrast truncate">
      {txHash}
    </div>
    <div className="h-2" />
    <ExternalDivisionLink className="w-full"
      href={`${context.chain.etherscan}/tx/${txHash}`}
      target="_blank" rel="noreferrer">
      <Button.Gradient className="w-full po-md"
        colorIndex={wallet.color}>
        <Button.Shrink>
          <Outline.ArrowTopRightOnSquareIcon className="s-sm" />
          Etherscan
        </Button.Shrink>
      </Button.Gradient>
    </ExternalDivisionLink>
  </>

  const sendDisabled = useMemo(() => {
    if (trySend.loading)
      return "Loading..."
    if (!defRecipientInput)
      return "Please enter a recipient"
    if (!defValueInput)
      return "Please enter an amount"
    return undefined
  }, [trySend.loading, defRecipientInput, defValueInput])

  const SendButton =
    <Button.Gradient className="w-full po-md"
      colorIndex={wallet.color}
      disabled={Boolean(sendDisabled)}
      onClick={trySend.run}>
      <Button.Shrink>
        <Outline.PaperAirplaneIcon className="s-sm" />
        {sendDisabled || "Send"}
      </Button.Shrink>
    </Button.Gradient>

  return <Dialog close={close}>
    <Dialog.Title close={close}>
      Send {title}
    </Dialog.Title>
    <div className="h-2" />
    {RecipientInput}
    <div className="h-2" />
    {ValueInput}
    <div className="h-4" />
    {NonceInput}
    <div className="h-4" />
    {txHash ? <>
      {TxHashDisplay}
    </> : <>
      {SendButton}
    </>}
  </Dialog>
}