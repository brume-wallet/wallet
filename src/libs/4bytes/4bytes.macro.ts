import { $run$ } from "@hazae41/saumon"
import { ethers } from "ethers"

$run$(async () => {

  interface Page {
    "next": string,
    "previous": null,
    "count": number,
    "results": Element[]
  }

  interface Element {
    "id": number
    "text_signature": string
    "bytes_signature": string,
    "hex_signature": string,
  }

  const gnosis = new ethers.JsonRpcProvider("https://gnosis.publicnode.com")
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, gnosis)

  // const batcher = new ethers.Contract("0x74163cF5905c756F02A5410C1Ee94a3f91FaF996", [ // safe
  const batcher = new ethers.Contract("0x018c71BCa7aF69b66fEbB0CeFD0590E4725e8e27", [ // unsafe
    {
      "inputs": [
        {
          "internalType": "contract Database",
          "name": "_database",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [
        {
          "internalType": "string[]",
          "name": "texts",
          "type": "string[]"
        }
      ],
      "name": "add",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ] as const, wallet)

  async function doFetch(url = "https://www.4byte.directory/api/v1/signatures/?page=536") {
    console.log("Fetching", url)
    const res = await fetch(url)

    if (!res.ok)
      return

    const page = await res.json() as Page
    const names = page.results.map(e => e.text_signature).filter(x => x !== "transfer(address,uint256)")

    const names0 = names.slice(0, 25)
    await batcher.add(names0).then(tx => tx.wait())

    if (page.next == null)
      return

    await doFetch(page.next)
  }

  await doFetch()
})