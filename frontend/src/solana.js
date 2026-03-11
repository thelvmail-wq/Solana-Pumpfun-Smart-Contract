import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Buffer } from 'buffer'

export const PROGRAM_ID = new PublicKey('9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx')
export const connection = new Connection('https://devnet.helius-rpc.com/?api-key=058c5cbb-e6d6-4f09-a110-aaa298b485c1', 'confirmed')

// ── Supabase config (read-only, anon key) ─────────
const SUPABASE_URL = 'https://zhhplcgfhrtjyruvlqkx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaHBsY2dmaHJ0anlydXZscWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDYwODksImV4cCI6MjA4ODY4MjA4OX0.vOBgtyishBXd1eq45jehrynefKS6F1hqyhlZWNBdr8c'

// Simple Supabase REST helper (no SDK needed in frontend)
async function supabaseGet(table, params = '') {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      }
    })
    if (!res.ok) return []
    return await res.json()
  } catch (e) {
    console.warn('supabaseGet error:', e.message)
    return []
  }
}

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

// ── Fetch holder count for a mint ─────────────────────────────
export async function fetchHolderCount(mintPubkey) {
  try {
    const mint = new PublicKey(mintPubkey)
    const result = await connection.getTokenLargestAccounts(mint)
    const holders = result.value.filter(a => a.uiAmount > 0).length
    return holders
  } catch (e) {
    console.warn('fetchHolderCount error:', e.message)
    return 0
  }
}

// ── Fetch candles from Supabase ───────────────────────────────
// timeframe: '1m', '5m', '15m', '1h', '4h', '1d'
// Returns array of { o, h, l, c, v, t } for the chart
export async function fetchCandles(mintPubkey, timeframe = '5m', limit = 100) {
  const data = await supabaseGet(
    'candles',
    `mint=eq.${mintPubkey}&timeframe=eq.${timeframe}&order=bucket_ts.desc&limit=${limit}`
  )
  // Reverse so oldest is first (chart expects left-to-right)
  return data.reverse().map(c => ({
    o: parseFloat(c.open),
    h: parseFloat(c.high),
    l: parseFloat(c.low),
    c: parseFloat(c.close),
    v: parseFloat(c.volume),
    t: c.bucket_ts,
  }))
}

// ── Fetch trade count + volume from Supabase ──────────────────
export async function fetchTradeStats(mintPubkey) {
  const data = await supabaseGet(
    'token_stats',
    `mint=eq.${mintPubkey}`
  )
  if (data.length > 0) {
    return {
      totalTrades: parseInt(data[0].total_trades) || 0,
      totalSolVolume: parseFloat(data[0].total_sol_volume) || 0,
      lastTradeAt: data[0].last_trade_at,
    }
  }
  return { totalTrades: 0, totalSolVolume: 0, lastTradeAt: null }
}

// ── Fetch recent trades for a token ───────────────────────────
export async function fetchRecentTrades(mintPubkey, limit = 50) {
  return await supabaseGet(
    'trades',
    `mint=eq.${mintPubkey}&order=timestamp.desc&limit=${limit}`
  )
}

// ── Swap instruction ──────────────────────────────────────────
export async function buildSwapTx(walletPubkey, mintPubkey, solAmount, isBuy) {
  const mint = new PublicKey(mintPubkey)
  const user = walletPubkey instanceof PublicKey ? walletPubkey : new PublicKey(walletPubkey)

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [dexConfig] = PublicKey.findProgramAddressSync([Buffer.from('CurveConfiguration')], PROGRAM_ID)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, global, true)
  const userTokenAcct = await getAssociatedTokenAddress(mint, user)

  const keys = [
    { pubkey: dexConfig,      isSigner: false, isWritable: true  },
    { pubkey: pool,           isSigner: false, isWritable: true  },
    { pubkey: global,         isSigner: false, isWritable: true  },
    { pubkey: mint,           isSigner: false, isWritable: true },
    { pubkey: poolTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: userTokenAcct,  isSigner: false, isWritable: true  },
    { pubkey: user,           isSigner: true,  isWritable: true  },
    { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]

  const data = Buffer.alloc(8 + 8 + 8)
  DISCRIMINATORS.swap.copy(data, 0)
  data.writeBigUInt64LE(BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)), 8)
  data.writeBigUInt64LE(BigInt(isBuy ? 0 : 1), 16)

  const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data })

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

// ── Add liquidity ─────────────────────────────────────────────
export async function buildAddLiquidityTx(walletPubkey, mintPubkey, solAmount) {
  const mint = new PublicKey(mintPubkey)
  const user = walletPubkey instanceof PublicKey ? walletPubkey : new PublicKey(walletPubkey)

  const [pool] = getPoolPDA(mint)
  const [global] = getGlobalPDA()
  const [liquidityProvider] = getLiquidityProviderPDA(mint, user)

  const poolTokenAcct = await getAssociatedTokenAddress(mint, global, true)
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
// ══════════════════════════════════════════════════════════════
export async function buildCreateRegistryTx(creatorPubkey, mintPubkey, ticker, imageHashBuf, identityHashBuf) {
  const mint = new PublicKey(mintPubkey)
  const creator = creatorPubkey instanceof PublicKey ? creatorPubkey : new PublicKey(creatorPubkey)

  const tickerBuf = await hashTicker(ticker)
  const imgHash = imageHashBuf || Buffer.alloc(32)
  const idHash = identityHashBuf || Buffer.alloc(32)

  const [tokenRegistry] = getTokenRegistryPDA(mint)

  const tickerRawBuf = Buffer.alloc(16)
  Buffer.from(ticker.trim().toUpperCase().slice(0, 16)).copy(tickerRawBuf)

  const data = Buffer.alloc(120)
  DISCRIMINATORS.create_token_registry.copy(data, 0)
  tickerBuf.copy(data, 8)
  imgHash.copy(data, 40)
  idHash.copy(data, 72)
  tickerRawBuf.copy(data, 104)

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
// claim_locks — 6 accounts
// ══════════════════════════════════════════════════════════════
export async function buildClaimLocksTx(creatorPubkey, mintPubkey, tickerBuf, imgHashBuf, idHashBuf) {
  const mint = new PublicKey(mintPubkey)
  const creator = creatorPubkey instanceof PublicKey ? creatorPubkey : new PublicKey(creatorPubkey)

  const [tokenRegistry] = getTokenRegistryPDA(mint)
  const [tickerLock] = PublicKey.findProgramAddressSync([Buffer.from('ticker_lock'), tickerBuf], PROGRAM_ID)
  const [imageLock] = PublicKey.findProgramAddressSync([Buffer.from('image_lock'), imgHashBuf], PROGRAM_ID)
  const [identityLock] = PublicKey.findProgramAddressSync([Buffer.from('identity_lock'), idHashBuf], PROGRAM_ID)

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

// Fetch pool data for a mint
export async function fetchPoolData(mintPubkey) {
  try {
    const mint = new PublicKey(mintPubkey)
    const [pool] = getPoolPDA(mint)
    const acct = await connection.getAccountInfo(pool)
    if (!acct) return null
    const d = acct.data
    const reserveOne = Number(d.readBigUInt64LE(80))
    const reserveTwo = Number(d.readBigUInt64LE(88))
    const launchTs = Number(d.readBigInt64LE(97))
    const graduated = d[105] === 1
    const totalSolRaised = Number(d.readBigUInt64LE(106))
    const creator = new PublicKey(d.slice(114, 146))
    const airdropPool = Number(d.readBigUInt64LE(146))
    const solReserve = reserveTwo / 1e9
    const tokenReserve = reserveOne / 1e9
    const solPrice = 180
    const raisedSOL = totalSolRaised / 1e9
    const pricePerToken = reserveOne > 0 ? reserveTwo / reserveOne : 0
    const mcap = reserveOne > 0 ? Math.round((reserveTwo / reserveOne) * 1e9 * solPrice) : 0
    return {
      hasPool: true, solReserve, tokenReserve, raisedSOL, mcap, pricePerToken,
      graduated, launchTs, creator: creator.toBase58(),
      airdropPool: airdropPool / 1e9,
      bondingFull: raisedSOL >= 85,
      prog: Math.min(100, Math.round((raisedSOL / 85) * 100)),
    }
  } catch (e) {
    console.error("fetchPoolData error:", e.message)
    return null
  }
}

// Fetch all tokens with real pool stats + holder count + trade stats
export async function fetchAllTokensWithPools() {
  const tokens = await fetchDeployedTokens()
  const enriched = await Promise.all(tokens.map(async (t) => {
    const pool = await fetchPoolData(t.mint)
    if (pool) {
      const holders = await fetchHolderCount(t.mint)
      const stats = await fetchTradeStats(t.mint)

      const solPrice = 180
      const volUsd = stats.totalSolVolume * solPrice
      const v = volUsd > 1e6 ? "$"+(volUsd/1e6).toFixed(1)+"M" : volUsd > 1e3 ? "$"+(volUsd/1e3).toFixed(0)+"K" : "$"+Math.round(volUsd)

      const nowSec = Math.floor(Date.now() / 1000)
      const ageSec = nowSec - pool.launchTs
      const ageDays = Math.max(0, Math.floor(ageSec / 86400))
      const ageMins = Math.max(0, Math.floor(ageSec / 60))

      return {
        ...t,
        mcap: pool.mcap,
        raisedSOL: pool.raisedSOL,
        bondingFull: pool.bondingFull,
        graduated: pool.graduated,
        prog: pool.prog,
        hasPool: true,
        vol: v,
        volRaw: volUsd,
        pricePerToken: pool.pricePerToken,
        solReserve: pool.solReserve,
        tokenReserve: pool.tokenReserve,
        airdropPool: pool.airdropPool,
        launchTs: pool.launchTs,
        holders: holders,
        txs: stats.totalTrades,
        age: ageDays,
        elapsed: ageMins,
        minsAgo: ageMins,
      }
    }
    return { ...t, hasPool: false }
  }))
  return enriched
}