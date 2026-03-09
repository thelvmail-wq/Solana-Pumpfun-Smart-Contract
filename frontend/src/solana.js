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

// ── Hash helpers ──────────────────────────────────────────────
export async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return Buffer.from(await crypto.subtle.digest('SHA-256', buf))
}

export async function hashTicker(ticker) {
  return sha256(ticker.trim().toUpperCase())
}

// ── Swap instruction ──────────────────────────────────────────
export async function buildSwapTx(walletPubkey, mintPubkey, solAmount, isBuy) {
  const mint = new PublicKey(mintPubkey)
  const user = walletPubkey instanceof PublicKey ? walletPubkey : new PublicKey(walletPubkey)

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [dexConfig] = PublicKey.findProgramAddressSync([Buffer.from('CurveConfiguration')], PROGRAM_ID)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, pool, true)
  const userTokenAcct = await getAssociatedTokenAddress(mint, user)

  const keys = [
    { pubkey: dexConfig,      isSigner: false, isWritable: false },
    { pubkey: pool,           isSigner: false, isWritable: true  },
    { pubkey: global,         isSigner: false, isWritable: false },
    { pubkey: mint,           isSigner: false, isWritable: true },
    { pubkey: poolTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: userTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: user,           isSigner: true,  isWritable: true  },
    { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // rent sysvar
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]

  // data: discriminator(8) + amount(u64 LE) + style(u64 LE)
  const data = Buffer.alloc(8 + 8 + 8)
  DISCRIMINATORS.swap.copy(data, 0)
  data.writeBigUInt64LE(BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)), 8)
  data.writeBigUInt64LE(BigInt(isBuy ? 1 : 0), 16)

  const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data })

  const tx = new Transaction()
  // Create user ATA if needed
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

// ── Add liquidity ─────────────────────────────────────────────
export async function buildAddLiquidityTx(walletPubkey, mintPubkey, solAmount) {
  const mint = new PublicKey(mintPubkey)
  const user = walletPubkey instanceof PublicKey ? walletPubkey : new PublicKey(walletPubkey)

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [liquidityProvider] = getLiquidityProviderPDA(mint, user)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, pool, true)
  const userTokenAcct = await getAssociatedTokenAddress(mint, user)

  const keys = [
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: global,           isSigner: false, isWritable: false },
    { pubkey: liquidityProvider,isSigner: false, isWritable: true  },
    { pubkey: mint,             isSigner: false, isWritable: true },
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

// ══════════════════════════════════════════════════════════════
// create_token_registry — 4 ACCOUNTS ONLY
// [token_registry, mint, creator, system_program]
// ══════════════════════════════════════════════════════════════
export async function buildCreateRegistryTx(creatorPubkey, mintPubkey, ticker, imageHashBuf, identityHashBuf) {
  const mint = new PublicKey(mintPubkey)
  const creator = creatorPubkey instanceof PublicKey ? creatorPubkey : new PublicKey(creatorPubkey)

  const tickerBuf = await hashTicker(ticker)
  const imgHash = imageHashBuf || Buffer.alloc(32)
  const idHash = identityHashBuf || Buffer.alloc(32)

  const [tokenRegistry] = getTokenRegistryPDA(mint)

  // ticker_raw: first 16 bytes of raw ticker string, null-padded
  const tickerRawBuf = Buffer.alloc(16)
  Buffer.from(ticker.trim().toUpperCase().slice(0, 16)).copy(tickerRawBuf)

  // data: disc(8) + ticker_hash(32) + image_hash(32) + identity_hash(32) + ticker_raw(16) = 120
  const data = Buffer.alloc(120)
  DISCRIMINATORS.create_token_registry.copy(data, 0)
  tickerBuf.copy(data, 8)
  imgHash.copy(data, 40)
  idHash.copy(data, 72)
  tickerRawBuf.copy(data, 104)

  // *** CRITICAL: 4 accounts ONLY — sending 7 causes AccountNotSigner (3010) ***
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry, isSigner: false, isWritable: true  },
      { pubkey: mint,          isSigner: false, isWritable: true  },
      { pubkey: creator,       isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  })

  const tx = new Transaction()
  tx.add(ix)
  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = creator
  return { tx, tickerBuf, imgHash, idHash }
}

// ══════════════════════════════════════════════════════════════
// claim_locks — SEPARATE instruction, 6 accounts
// [token_registry, ticker_lock, image_lock, identity_lock, creator, system_program]
// Args: [ticker_hash(32), image_hash(32), identity_hash(32)] = 96 bytes after disc
// ══════════════════════════════════════════════════════════════
export async function buildClaimLocksTx(creatorPubkey, mintPubkey, tickerBuf, imgHashBuf, idHashBuf) {
  const mint = new PublicKey(mintPubkey)
  const creator = creatorPubkey instanceof PublicKey ? creatorPubkey : new PublicKey(creatorPubkey)

  const [tokenRegistry] = getTokenRegistryPDA(mint)
  const [tickerLock] = PublicKey.findProgramAddressSync([Buffer.from('ticker_lock'), tickerBuf], PROGRAM_ID)
  const [imageLock] = PublicKey.findProgramAddressSync([Buffer.from('image_lock'), imgHashBuf], PROGRAM_ID)
  const [identityLock] = PublicKey.findProgramAddressSync([Buffer.from('identity_lock'), idHashBuf], PROGRAM_ID)

  // data: disc(8) + ticker_hash(32) + image_hash(32) + identity_hash(32) = 104
  const data = Buffer.alloc(104)
  DISCRIMINATORS.claim_locks.copy(data, 0)
  tickerBuf.copy(data, 8)
  imgHashBuf.copy(data, 40)
  idHashBuf.copy(data, 72)

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry, isSigner: false, isWritable: false },
      { pubkey: tickerLock,    isSigner: false, isWritable: true  },
      { pubkey: imageLock,     isSigner: false, isWritable: true  },
      { pubkey: identityLock,  isSigner: false, isWritable: true  },
      { pubkey: creator,       isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  })

  const tx = new Transaction()
  tx.add(ix)
  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = creator
  return tx
}

// ══════════════════════════════════════════════════════════════
// Fetch all TokenRegistry accounts (dataSize: 202)
// ══════════════════════════════════════════════════════════════
export async function fetchDeployedTokens() {
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: 202 }]
    })
    console.log(`fetchDeployedTokens: found ${accounts.length} registries`)
    return accounts.map(({ pubkey, account }) => {
      const data = account.data
      // Layout: disc(8) + mint(32) + ticker_hash(32) + image_hash(32) + identity_hash(32)
      //       + ticker_raw(16) + is_protected(1) + protected_at(8) + creator(32) + created_at(8)
      //       = 8+32+32+32+32+16+1+8+32+8 = 201... +1 padding? = 202
      const mint = new PublicKey(data.slice(8, 40))
      const tickerRaw = data.slice(136, 152)
      const tickerEnd = tickerRaw.indexOf(0)
      const ticker = new TextDecoder().decode(tickerRaw.slice(0, tickerEnd === -1 ? 16 : tickerEnd)).trim()
      const isProtected = data[152] === 1
      const protectedAt = Number(data.readBigInt64LE(153))
      const creatorKey = new PublicKey(data.slice(161, 193))
      const createdAtTs = Number(data.readBigInt64LE(193))
      const ageMs = Date.now() - createdAtTs * 1000
      const ageMins = Math.floor(ageMs / 60000)
      const ageDays = Math.floor(ageMs / 86400000)

      console.log(`  Token: ${ticker || 'UNKNOWN'} | mint: ${mint.toBase58().slice(0,8)}... | age: ${ageMins}m`)

      return {
        id: mint.toBase58(),
        pubkey: pubkey.toBase58(),
        mint: mint.toBase58(),
        mintAddress: mint.toBase58(),
        sym: ticker || 'UNKNOWN',
        name: ticker || 'Unknown Token',
        pi: Math.abs(data[8] + data[9]) % 8,
        mcap: 0,
        chg: 0,
        prog: 0,
        holders: 0,
        age: ageDays,
        raisedSOL: 0,
        raisedSOLMax: 85,
        elapsed: ageMins,
        vol: '$0',
        volRaw: 0,
        txs: 0,
        desc: 'Deployed on-chain',
        bondingFull: false,
        minsAgo: ageMins,
        graduated: false,
        topicLocked: false,
        topicSource: null,
        topicTitle: null,
        tw: null,
        tg: null,
        web: null,
        creator: creatorKey.toBase58(),
        createdAt: createdAtTs,
        isProtected,
        isOnChain: true,
      }
    })
  } catch (e) {
    console.error('fetchDeployedTokens error:', e)
    return []
  }
}