# Signing isolation

The browser wallet keeps the recovery phrase and the active Warthog private
key in one module worker. Screens ask that worker for a public address or a
signature. They do not hold the phrase for the session, and a send does not
copy the Warthog key onto the page.

This note is the contract for this app. The source of the change is
`warthog/browser-wallet` commit `782431b`. The phone app has no Vite worker.
The same boundary is a module that is the only holder of the phrase and the
Warthog key. UI and chain code call it and receive addresses or signatures.

## What the page is allowed to see

- Public chain addresses for the selected account.
- A signature, or a signed Warthog transaction JSON.
- The phrase and the Warthog key only when the user asks to reveal them, write
  the backup, or save the encrypted wallet. That path is `exportWallet`.

React `seedPhrase` is set only while the create or restore backup screen is
open. Leaving that screen clears it. Login unlocks the worker with the phrase
once, then clears the React copy. Adding or switching an account calls
`activateAccount` inside the worker. The page stores the new public key and
address.

`browser-wallet/src/mobile-port/utils/sessionVault.ts` stores the selected account index.
`getSessionMnemonic()` returns `""`. `getSessionPrivateKey()` returns `""`.
`setChainSession(mnemonic, index)` ignores the phrase and records the index
only when the phrase string is non-empty. Lock and a Ledger login set the
index back to 0.

Private-key imports have no phrase. Warthog still signs with the key in the
worker. Ethereum, Hemi, Bitcoin, and Solana return no public address from
`chainPublic` and keep their existing "no recovery phrase" errors. Ledger
signing is unchanged and still uses the device.

There is no extra prompt. Auto-lock still locks the worker.

## Worker actions

`browser-wallet/src/workers/signingWorker.ts` is one module worker per document. It holds
`privateKey`, `publicKey`, `address`, and `mnemonic`.

| Action | Returns |
| --- | --- |
| `unlock` | Stores the key. Stores the phrase when one was passed. |
| `lock` | Clears all four fields. |
| `status` | `unlocked`, `address`, `publicKey`, `hasMnemonic`. No secrets. |
| `exportWallet` | The four fields. Reveal and backup only. |
| `chainPublic` | ETH, Bitcoin, and Solana public data for an index. Needs the phrase. |
| `activateAccount` | Derives Warthog account `index` on `hardened` or `non-hardened` and replaces the active key. |
| `signEthereum` | EIP-1559 `signature.serialized` for an unsigned transaction. |
| `signSolana` | A 64-byte ed25519 signature of the message. |
| `signBitcoin` | `{ hex, txid }` for a PSBT from `planBtcPsbt` (`toPSBT(2)`). |
| `signWarthog` | Signed Warthog JSON. Bigints travel as `{ $bigint: "<decimal>" }`. |

`browser-wallet/src/workers/phraseSign.ts` derives a chain key, signs, and fills the derived
key bytes with zeros. JavaScript strings cannot be wiped. That is why the
phrase stays in the worker instead of being copied out and blanked.

`browser-wallet/src/utils/signingBridge.ts` is the page side: `chainPublicFromWorker`,
`activateWorkerAccount`, `signEthereumInWorker`, `signSolanaInWorker`,
`signBitcoinInWorker`, `signPreparedWarthog`, and `exportWalletFromWorker`.

## Warthog signing

The page still builds the pin, the fee, and the nonce with
`createTransactionContext` or the DeFi API. Only the `Account` and the sign
step move. The request is serializable because a closure cannot run in the
worker.

Context fields:

- `family`: `"legacy"` or `"defi"` (`ctx instanceof WarthogDeFiTransactionContext`)
- `pinHash`, `pinHeight`, `nonceId`
- `feeE8`: decimal string of `ctx.fee.E8`

Operations in `browser-wallet/src/workers/warthogSign.ts`:

| `op` | Fields | Library call |
| --- | --- | --- |
| `wartTransfer` | `toAddr`, `amountE8` | `transferWart` |
| `tokenTransfer` | `assetHash`, `isLiquidity`, `toAddr`, `amountU64` | `transferAsset` or `transferLiquidity` |
| `limitSwap` | `assetHash`, `isBuy`, `amountU64`, `limitHex` | `buy` or `sell` |
| `liquidityDeposit` | `assetHash`, `amountU64`, `wartE8` | `depositLiquidity` |
| `liquidityWithdrawal` | `assetHash`, `amountE8` | `withdrawLiquidity` |
| `cancelation` | `cancelHeight`, `cancelNonceId` | `cancelTransaction` |
| `assetCreation` | `supplyU64`, `decimals`, `name` | `createAssets` |

Amounts are decimal strings of the integer the library already parsed
(`Wart.E8`, `Funds.amount`, `Liquidity.E8`). `limitHex` is `Price.toHex()`.
Addresses are `Address.hex`.

`exactFee` keeps that `feeE8` when `RoundedFee.fromE8(e8, false)` or
`RoundedFee.fromE8(e8, true)` returns the same value. A node-rounded fee must
not be rounded again. Anything else throws `Invalid fee`.

If `expectedAddress` is set, it is compared to `Account.address.hex` with the
`0x` prefix removed and the case ignored. A mismatch throws `The active
account changed. Review the transaction again.` A locked wallet throws
`Wallet is locked — unlock to sign` before the worker is asked. A non-transfer
on a legacy context throws `This transaction needs a DeFi node`. The Send
screen still checks that itself, before signing, so the older string stays.

The worker encodes each top-level bigint as `{ $bigint: "<digits>" }`. The
page revives those to bigint so `submitTransaction` still uses the library's
JSON replacer. A same-thread phone signer can return the library object and
skip that encoding. Keep the request shape either way, so the UI never
receives an `Account`.

Browser call sites:

- `browser-wallet/src/pages/Home.tsx` — dApp `transferWart` approval
- `browser-wallet/src/pages/Sendstep2.tsx` — WART, token, and liquidity. The Send screen
  still throws `Wallet is locked` and `Signing account changed. Start the send
  again.` before it asks the worker.
- `browser-wallet/src/pages/SafeTradePage.tsx` — WART deposit
- `browser-wallet/src/utils/defiClient.ts` — `signAndSubmit` for create, transfer, limit
  swap, liquidity deposit, liquidity withdrawal, and cancel

`accountFromPrivateKey` remains a pure helper. It is not the session path.

## Phone files that still hold the secret

`utils/sessionVault.ts` keeps the whole `WalletData`, including
`privateKey` and `mnemonic`. `getSessionPrivateKey()` and
`getSessionMnemonic()` hand those to callers. `publicWallet()` already blanks
them for React. The session object does not.

These callers sign with the session key or phrase today:

| Phone file | What it does |
| --- | --- |
| `hooks/useSendTransaction.ts` | `Account.fromPrivateKeyHex(getSessionPrivateKey())`, then `transferWart` |
| `Wallet.tsx` | Home WART send, same pattern, next to the Ledger branch |
| `utils/exchange/walletSend.ts` | SafeTrade WART deposit |
| `utils/defiSubmit.ts` | `signAndSubmitDefiTx` passes `Account` into a build closure |
| `utils/ethChain.ts` | Ethereum sign from `getSessionMnemonic()` |
| `utils/networks/hemi.ts` | Hemi sign from the phrase |
| `utils/networks/btc.ts` | Bitcoin sign from the phrase |
| `utils/networks/solana.ts` | Solana sign from the phrase |
| `utils/networks/jupBridge.ts` | Bridge sign from the phrase |
| `utils/networks/debridge.ts` | Bridge sign from the phrase |

`components/WalletModal.tsx` shares the phrase on purpose. That stays an
explicit export, same as `exportWallet`. `utils/crypto.ts` may derive a key
while a wallet is being created or imported. It should not leave that key in
the session for later sends.

The phone DeFi gate says `Switch this wallet to the DeFi testnet before this
transaction.` Keep that string at the call site. The shared signer says `This
transaction needs a DeFi node` when the family is legacy.

## What to bring across

Copy the pure signers, not the Vite worker:

- `browser-wallet/src/workers/phraseSign.ts`
- `browser-wallet/src/workers/warthogSign.ts`

Point the phone session module at those functions. Unlock stores the phrase
and the active Warthog key there. Send, swap, and bridge code pass the
unsigned transaction or a `WarthogSignRequest` and take back the signature.
Public addresses for other chains come from `publicChains`. Switching accounts
uses the same derivation the worker's `activateAccount` uses
(`deriveAccountAtIndex`).

Leave these behaviors in place:

- Ledger branches and their errors.
- Reveal and encrypted backup, as an explicit export.
- The existing user-facing errors listed above.
- Node reads, fee lookup, and `submitWarthogTransaction` on the caller side.
- The comment in the phone send path: a node-rounded `feeE8` is not run
  through ceil rounding again. `exactFee` is what enforces that.

## Tests

In `browser-wallet`: `npx --yes bun@1.2.21 test tests` and `npx tsc -b --pretty false`.

- `browser-wallet/tests/phrase-sign.test.ts` checks ETH, Bitcoin, and Solana signatures for
  the public BIP39 test phrase. Do not use that phrase for funds.
- `browser-wallet/tests/warthog-sign.test.ts` signs with `warthog-ts` and with `signWarthogTx`
  and requires the JSON to match, including a fee that was already rounded up.
  The signed JSON must not contain the private key. The wrong expected address
  is refused.
- `browser-wallet/tests/account-networks.test.ts` checks that the session stores the account
  index and not the phrase.

Account 0 of that test phrase has Ethereum address
`0x9858EfFD232B4033E47d90003D41EC34EcaEda94`.
