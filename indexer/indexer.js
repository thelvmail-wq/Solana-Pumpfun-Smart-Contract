// ================================================
// SUMMIT.MOON — Trade Indexer
// Polls swap transactions from Solana devnet,
// parses trade data, writes to Supabase.
// 
// Run: node indexer.js
// Deploy: Railway / Fly.io / any Node host
// ================================================

import { Connection, PublicKey } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────
const PROGRAM_ID = new PublicKey('73wyBdTRbZPegtYQbjs4uCAvkiUK9wWKd91WWJHyYL3j');
const RPC_URL = 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

const SUPABASE_URL = 'https://zhhplcgfhrtjyruvlqkx.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaHBsY2dmaHJ0anlydXZscWt4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEwNjA4OSwiZXhwIjoyMDg4NjgyMDg5fQ.STY_OKYdV4rUalRmHVfu0yjE10qoW9HbNEyB5fOV80M';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SWAP_DISC = 'f8c69e91e17587c8';
const POLL_INTERVAL_MS = 10_000; // 10 seconds
const SOL_PRICE = 180; // for mcap calc, update later

// ── PDA helpers ───────────────────────────────────
function getPoolPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('liquidity_pool'), mint.toBuffer()],
    PROGRAM_ID
  );
}

function getGlobalPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global')],
    PROGRAM_ID
  );
}

// ── Fetch all pool accounts (170 bytes) ───────────
async function fetchAllPools() {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 170 }]
  });
  
  const pools = [];
  for (const { pubkey, account } of accounts) {
    try {
      const d = account.data;
      // Pool layout: we need the mint which is stored in the account
      // Pool PDA is derived from mint, so we need to find the mint
      // The pool data starts with discriminator(8), then has fields
      // We'll use the pool pubkey to match transactions
      const reserveOne = Number(d.readBigUInt64LE(80));
      const reserveTwo = Number(d.readBigUInt64LE(88));
      
      pools.push({
        poolPubkey: pubkey.toBase58(),
        reserveOne,
        reserveTwo,
      });
    } catch (e) {
      // skip malformed
    }
  }
  return pools;
}

// ── Fetch all token registries to get mint addresses ──
async function fetchAllMints() {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 202 }]
  });
  
  const mints = [];
  for (const { pubkey, account } of accounts) {
    try {
      const data = account.data;
      const mint = new PublicKey(data.slice(8, 40));
      const tickerRaw = data.slice(136, 152);
      const tickerEnd = tickerRaw.indexOf(0);
      const ticker = Buffer.from(tickerRaw.slice(0, tickerEnd === -1 ? 16 : tickerEnd)).toString().trim();
      const [poolPDA] = getPoolPDA(mint);
      
      // Try to get pool reserves for price fallback
      let reserveOne = 0, reserveTwo = 0;
      try {
        const poolAcct = await connection.getAccountInfo(poolPDA);
        if (poolAcct && poolAcct.data.length >= 96) {
          reserveOne = Number(poolAcct.data.readBigUInt64LE(80));
          reserveTwo = Number(poolAcct.data.readBigUInt64LE(88));
        }
      } catch (e) { /* skip */ }
      
      mints.push({
        mint: mint.toBase58(),
        ticker: ticker || 'UNKNOWN',
        poolPDA: poolPDA.toBase58(),
        reserveOne,
        reserveTwo,
      });
    } catch (e) {
      // skip
    }
  }
  return mints;
}

// ── Parse a swap transaction ──────────────────────
function parseSwapFromTx(tx, mintInfo) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  
  const msg = tx.transaction.message;
  const accountKeys = msg.accountKeys || msg.staticAccountKeys || [];
  
  // Check if this tx involves our program
  const programIdx = accountKeys.findIndex(k => k.toBase58() === PROGRAM_ID.toBase58());
  if (programIdx === -1) return null;
  
  // Check ALL instructions for one with our program AND swap discriminator
  const instructions = msg.compiledInstructions || msg.instructions || [];
  let swapIx = null;
  let dataBuf = null;
  
  for (const ix of instructions) {
    const pIdx = ix.programIdIndex !== undefined ? ix.programIdIndex : -1;
    if (pIdx !== programIdx) continue;
    
    // Decode data
    let buf;
    if (Buffer.isBuffer(ix.data)) buf = ix.data;
    else if (ix.data instanceof Uint8Array) buf = Buffer.from(ix.data);
    else if (typeof ix.data === 'string') buf = Buffer.from(ix.data, 'base58');
    else continue;
    
    if (buf.length < 24) continue;
    const disc = buf.slice(0, 8).toString('hex');
    if (disc === SWAP_DISC) {
      swapIx = ix;
      dataBuf = buf;
      break;
    }
  }
  
  if (!swapIx || !dataBuf) return null;
  
  // Parse: disc(8) + amount(u64 LE, 8) + style(u64 LE, 8)
  const amount = Number(dataBuf.readBigUInt64LE(8));
  const style = Number(dataBuf.readBigUInt64LE(16));
  const isBuy = style === 0;
  const solAmount = amount / 1e9; // lamports to SOL
  
  // Get the user (signer)
  const signerKey = accountKeys[0]?.toBase58();
  
  // Get the mint from account keys — it's index 3 in the swap accounts
  const ixAccounts = swapIx.accounts || swapIx.accountKeyIndexes || [];
  const mintIdx = ixAccounts[3]; // mint is 4th account (index 3)
  const mintKey = typeof mintIdx === 'number' ? accountKeys[mintIdx]?.toBase58() : mintIdx?.toBase58();
  
  if (!mintKey) return null;
  
  // Calculate price from pre/post SOL and token balance changes
  let tokenAmount = 0;
  let solChanged = 0;
  let price = 0;
  
  // Get SOL change from pre/post balances (most reliable)
  if (tx.meta.preBalances && tx.meta.postBalances) {
    // Signer is index 0 — their SOL change is the trade amount
    const preSol = tx.meta.preBalances[0] / 1e9;
    const postSol = tx.meta.postBalances[0] / 1e9;
    solChanged = Math.abs(postSol - preSol);
    // Subtract estimated tx fee (~0.000005 SOL)
    if (solChanged > 0.00001) solChanged = Math.max(0, solChanged - 0.000005);
  }
  
  // Get token change from pre/post token balances
  if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
    for (const post of tx.meta.postTokenBalances) {
      if (post.mint !== mintKey) continue;
      const pre = tx.meta.preTokenBalances.find(
        p => p.accountIndex === post.accountIndex && p.mint === mintKey
      );
      const preAmt = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || '0') : 0;
      const postAmt = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
      const diff = Math.abs(postAmt - preAmt);
      if (diff > tokenAmount) tokenAmount = diff;
    }
    
    // Also check for new accounts (pre might not exist)
    if (tokenAmount === 0) {
      for (const post of tx.meta.postTokenBalances) {
        if (post.mint !== mintKey) continue;
        const hasPre = tx.meta.preTokenBalances.some(p => p.accountIndex === post.accountIndex);
        if (!hasPre) {
          const amt = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
          if (amt > tokenAmount) tokenAmount = amt;
        }
      }
    }
  }
  
  // Price = SOL per token
  const effectiveSol = solChanged > 0 ? solChanged : solAmount;
  if (tokenAmount > 0 && effectiveSol > 0) {
    price = effectiveSol / tokenAmount;
  }
  
  // Fallback: use pool reserves to estimate price
  if (price === 0 || price > 1) {
    const info = mintInfo.find(m => m.mint === mintKey);
    if (info && info.reserveOne > 0 && info.reserveTwo > 0) {
      // reserveTwo = SOL lamports, reserveOne = token raw
      price = (info.reserveTwo / 1e9) / (info.reserveOne / 1e9);
    }
  }
  
  return {
    mint: mintKey,
    wallet: signerKey,
    side: isBuy ? 'buy' : 'sell',
    sol_amount: solAmount,
    token_amount: tokenAmount,
    price: price,
    slot: tx.slot,
  };
}

// ── Get last processed signature for a mint ───────
async function getLastSig(mint) {
  const { data } = await supabase
    .from('trades')
    .select('tx_sig')
    .eq('mint', mint)
    .order('timestamp', { ascending: false })
    .limit(1);
  
  return data?.[0]?.tx_sig || null;
}

// ── Upsert a candle ───────────────────────────────
function getBucket(timestamp, timeframe) {
  const d = new Date(timestamp);
  const ms = d.getTime();
  
  const intervals = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
  };
  
  const interval = intervals[timeframe] || 300_000;
  const bucketMs = Math.floor(ms / interval) * interval;
  return new Date(bucketMs).toISOString();
}

async function upsertCandle(trade, timeframe) {
  const bucketTs = getBucket(trade.timestamp, timeframe);
  
  // Try to get existing candle
  const { data: existing } = await supabase
    .from('candles')
    .select('*')
    .eq('mint', trade.mint)
    .eq('timeframe', timeframe)
    .eq('bucket_ts', bucketTs)
    .limit(1);
  
  if (existing && existing.length > 0) {
    const c = existing[0];
    await supabase
      .from('candles')
      .update({
        high: Math.max(c.high, trade.price),
        low: Math.min(c.low, trade.price),
        close: trade.price,
        volume: c.volume + trade.sol_amount,
        trade_count: c.trade_count + 1,
      })
      .eq('id', c.id);
  } else {
    await supabase
      .from('candles')
      .insert({
        mint: trade.mint,
        timeframe,
        bucket_ts: bucketTs,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.sol_amount,
        trade_count: 1,
      });
  }
}

// ── Process new transactions for a pool ───────────
async function processPool(mintInfo) {
  const { mint, poolPDA, ticker } = mintInfo;
  
  try {
    // Fetch recent signatures for the pool PDA — always fetch all, duplicates handled by DB unique constraint
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(poolPDA),
      { limit: 50 }
    );
    
    if (sigs.length === 0) return 0;
    
    console.log(`  ${ticker}: checking ${sigs.length} txs on pool ${poolPDA.slice(0,8)}...`);
    
    let newTrades = 0;
    
    // Process oldest first
    for (const sigInfo of sigs.reverse()) {
      if (sigInfo.err) {
        console.log(`    skip ${sigInfo.signature.slice(0,8)}... (failed tx)`);
        continue;
      }
      
      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx) {
          console.log(`    skip ${sigInfo.signature.slice(0,8)}... (null tx)`);
          continue;
        }
        
        const trade = parseSwapFromTx(tx, [mintInfo]);
        if (!trade) {
          // Log what instruction this was
          const msg = tx.transaction.message;
          const accountKeys = msg.accountKeys || msg.staticAccountKeys || [];
          const instructions = msg.compiledInstructions || msg.instructions || [];
          for (const ix of instructions) {
            const pIdx = ix.programIdIndex !== undefined ? ix.programIdIndex : -1;
            const progKey = typeof pIdx === 'number' && accountKeys[pIdx] ? accountKeys[pIdx].toBase58() : 'unknown';
            if (progKey === PROGRAM_ID.toBase58()) {
              let dataBuf;
              if (Buffer.isBuffer(ix.data)) dataBuf = ix.data;
              else if (ix.data instanceof Uint8Array) dataBuf = Buffer.from(ix.data);
              else if (typeof ix.data === 'string') dataBuf = Buffer.from(ix.data, 'base58');
              const disc = dataBuf ? dataBuf.slice(0,8).toString('hex') : 'no-data';
              console.log(`    skip ${sigInfo.signature.slice(0,8)}... (disc: ${disc}, not swap ${SWAP_DISC})`);
            }
          }
          continue;
        }
        
        const timestamp = new Date((tx.blockTime || Math.floor(Date.now()/1000)) * 1000).toISOString();
        
        // Insert trade
        const { error } = await supabase
          .from('trades')
          .insert({
            tx_sig: sigInfo.signature,
            mint: trade.mint,
            wallet: trade.wallet,
            side: trade.side,
            sol_amount: trade.sol_amount,
            token_amount: trade.token_amount,
            price: trade.price,
            timestamp: timestamp,
            slot: trade.slot,
          });
        
        if (error) {
          if (error.code === '23505') continue; // duplicate, silent skip
          console.error(`  Insert error: ${error.message}`);
          continue;
        }
        
        // Update candles for all timeframes
        const tradeWithTs = { ...trade, timestamp };
        for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
          await upsertCandle(tradeWithTs, tf);
        }
        
        newTrades++;
        console.log(`  ✅ ${trade.side.toUpperCase()} ${trade.sol_amount.toFixed(4)} SOL | ${ticker} | ${sigInfo.signature.slice(0,8)}...`);
        
      } catch (txErr) {
        console.error(`  TX parse error: ${txErr.message}`);
      }
      
      // Rate limit — don't hammer the RPC
      await new Promise(r => setTimeout(r, 200));
    }
    
    return newTrades;
    
  } catch (e) {
    console.error(`  Pool ${ticker} error: ${e.message}`);
    return 0;
  }
}

// ── Main loop ─────────────────────────────────────
async function runOnce() {
  console.log(`\n[${new Date().toISOString()}] Polling...`);
  
  const mints = await fetchAllMints();
  console.log(`Found ${mints.length} tokens`);
  
  let totalNew = 0;
  
  for (const mintInfo of mints) {
    const n = await processPool(mintInfo);
    if (n > 0) {
      totalNew += n;
      console.log(`  ${mintInfo.ticker}: ${n} new trades`);
    }
  }
  
  if (totalNew > 0) {
    console.log(`Total new trades: ${totalNew}`);
  } else {
    console.log('No new trades');
  }
}

async function main() {
  console.log('========================================');
  console.log('SUMMIT.MOON Trade Indexer');
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS/1000}s`);
  console.log('========================================\n');
  
  // Initial run
  await runOnce();
  
  // Poll loop
  setInterval(async () => {
    try {
      await runOnce();
    } catch (e) {
      console.error('Poll error:', e.message);
    }
  }, POLL_INTERVAL_MS);

  // Health check HTTP server for Railway
  const http = await import('http');
  const PORT = process.env.PORT || 3001;
  http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else {
      res.writeHead(200);
      res.end('SUMMIT.MOON Indexer running');
    }
  }).listen(PORT, () => {
    console.log(`Health check on port ${PORT}`);
  });
}

// Catch unhandled errors — log but don't crash
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
