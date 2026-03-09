import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Buffer } from 'buffer'

export const PROGRAM_ID = new PublicKey('9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx')
export const connection = new Connection('https://api.devnet.solana.com', 'confirmed')

// Discriminators
const DISCRIMINATORS = {
  add_liquidity: Buffer.from('b59d59438fb63448', 'hex'),
  swap:          Buffer.from('f8c69e91e17587c8', 'hex'),
  create_token_registry: Buffer.from('ec4062c2843c7324', 'hex'),
  claim_locks:   Buffer.from('50ac2a7b3fc26165', 'hex'),
}

// PDAs
export function getPoolPDA(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('liquidity_pool'), mint.toBuffer()], PROGRAM_ID)
}
export function getGlobalPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from('global')], PROGRAM_ID)
}
export function getLiquidityProviderPDA(mint, user) {
  return PublicKey.findProgramAddressSync([Buffer.from('LiqudityProvider'), mint.toBuffer(), user.toBuffer()], PROGRAM_ID)
}
export function getTokenRegistryPDA(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('token_registry'), mint.toBuffer()], PROGRAM_ID)
}

// Fetch all pools from program accounts
export async function fetchPools() {
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: 500 }] // approximate pool account size
    })
    return accounts
  } catch (e) {
    console.error('fetchPools error:', e)
    return []
  }
}

// Swap instruction
export async function buildSwapTx(wallet, mintPubkey, solAmount, isBuy) {
  const mint = new PublicKey(mintPubkey)
  const user = wallet.publicKey

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [dexConfig] = PublicKey.findProgramAddressSync([Buffer.from('dex_config')], PROGRAM_ID)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, pool, true)
  const userTokenAcct = await getAssociatedTokenAddress(mint, user)

  const keys = [
    { pubkey: dexConfig,      isSigner: false, isWritable: false },
    { pubkey: pool,           isSigner: false, isWritable: true  },
    { pubkey: global,         isSigner: false, isWritable: false },
    { pubkey: mint,           isSigner: false, isWritable: false },
    { pubkey: poolTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: userTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: user,           isSigner: true,  isWritable: true  },
    { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // rent
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]

  // data: discriminator + amount (u64 le) + direction (u8)
  const data = Buffer.alloc(8 + 8 + 1)
  DISCRIMINATORS.swap.copy(data, 0)
  data.writeBigUInt64LE(BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)), 8)
  data.writeUInt8(isBuy ? 1 : 0, 16)

  const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data })

  // Create user token account if needed
  const tx = new Transaction()
  const acctInfo = await connection.getAccountInfo(userTokenAcct)
  if (!acctInfo) {
    tx.add(createAssociatedTokenAccountInstruction(user, userTokenAcct, user, mint))
  }
  tx.add(ix)

  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = user

  return tx
}

// Add liquidity (deploy token)
export async function buildAddLiquidityTx(wallet, mintPubkey, solAmount) {
  const mint = new PublicKey(mintPubkey)
  const user = wallet.publicKey

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [liquidityProvider] = getLiquidityProviderPDA(mint, user)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, pool, true)
  const userTokenAcct = await getAssociatedTokenAddress(mint, user)

  const keys = [
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: global,           isSigner: false, isWritable: false },
    { pubkey: liquidityProvider,isSigner: false, isWritable: true  },
    { pubkey: mint,             isSigner: false, isWritable: false },
    { pubkey: poolTokenAcct,    isSigner: false, isWritable: true  },
    { pubkey: userTokenAcct,    isSigner: false, isWritable: true  },
    { pubkey: user,             isSigner: true,  isWritable: true  },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]

  const data = Buffer.alloc(8 + 8)
  DISCRIMINATORS.add_liquidity.copy(data, 0)
  data.writeBigUInt64LE(BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)), 8)

  const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data })
  const tx = new Transaction()
  tx.add(ix)

  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = user

  return tx
}

// Deploy token: create_token_registry + claim_locks
export async function buildDeployTx(wallet, mintPubkey, ticker, imageHash, identityHash) {
  const mint = new PublicKey(mintPubkey)
  const creator = wallet
  const [tokenRegistry] = getTokenRegistryPDA(mint)

  // ticker hash
  const enc = new TextEncoder()
  const tickerHash = await crypto.subtle.digest('SHA-256', enc.encode(ticker.trim().toUpperCase()))
  const tickerBuf = Buffer.from(tickerHash)
  const [tickerLock] = PublicKey.findProgramAddressSync([Buffer.from('ticker_lock'), tickerBuf], PROGRAM_ID)
  const [imageLock] = PublicKey.findProgramAddressSync([Buffer.from('image_lock'), Buffer.from(imageHash||new Uint8Array(32))], PROGRAM_ID)
  const [identityLock] = PublicKey.findProgramAddressSync([Buffer.from('identity_lock'), Buffer.from(identityHash||new Uint8Array(32))], PROGRAM_ID)

  // ix1: create_token_registry — 8 disc + 32 ticker_hash + 32 image_hash + 32 identity_hash + 16 ticker_raw
  const tickerRawBuf = Buffer.alloc(16)
  Buffer.from(ticker.slice(0,16)).copy(tickerRawBuf)
  const imgHash = Buffer.alloc(32)
  if(imageHash) Buffer.from(imageHash).copy(imgHash)
  const idHash = Buffer.alloc(32)
  if(identityHash) Buffer.from(identityHash).copy(idHash)
  const data1 = Buffer.alloc(8 + 32 + 32 + 32 + 16)
  DISCRIMINATORS.create_token_registry.copy(data1, 0)
  tickerBuf.copy(data1, 8)
  imgHash.copy(data1, 40)
  idHash.copy(data1, 72)
  tickerRawBuf.copy(data1, 104)
  const ix1 = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry, isSigner: false, isWritable: true },
      { pubkey: mint,          isSigner: false, isWritable: false },
      { pubkey: creator,       isSigner: true,  isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data1,
  })

  // ix2: claim_locks
  const data2 = Buffer.alloc(8 + 32 + 32 + 32)
  DISCRIMINATORS.claim_locks.copy(data2, 0)
  tickerBuf.copy(data2, 8)
  imgHash.copy(data2, 40)
  idHash.copy(data2, 72)
  const ix2 = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry, isSigner: false, isWritable: true },
      { pubkey: tickerLock,    isSigner: false, isWritable: true },
      { pubkey: imageLock,     isSigner: false, isWritable: true },
      { pubkey: identityLock,  isSigner: false, isWritable: true },
      { pubkey: creator,       isSigner: true,  isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data2,
  })

  const { ComputeBudgetProgram } = await import('@solana/web3.js')
  const tx = new Transaction()
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }))
  tx.add(ix1, ix2)
  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = creator
  return tx
}
