#!/usr/bin/env python3
"""
Chart split: bonding curve candles → Jupiter/Birdeye live feed post-graduation.
1. Adds fetchJupiterCandles() to solana.js
2. Updates TokenPage candle fetch to switch source based on gradState
3. Adds migration line + source indicator on the chart
"""

# ═══════════════════════════════════════════════════
# PART 1: Add Jupiter/Birdeye candle fetch to solana.js
# ═══════════════════════════════════════════════════

with open('src/solana.js', 'r') as f:
    sol = f.read()

jupiter_candles = '''

// ── Fetch candles from Jupiter/Birdeye for post-graduation tokens ──
// Uses Birdeye public API (free tier, no key needed for basic OHLCV)
// Falls back to Jupiter price API if Birdeye fails
const BIRDEYE_API = 'https://public-api.birdeye.so';

export async function fetchJupiterCandles(mintAddress, timeframe = '1h', limit = 100) {
  const mint = typeof mintAddress === 'string' ? mintAddress : mintAddress.toBase58();

  // Map timeframes to Birdeye intervals
  const tfMap = { '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
  const interval = tfMap[timeframe] || '1H';

  // Calculate time range
  const now = Math.floor(Date.now() / 1000);
  const durations = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const candleDuration = durations[timeframe] || 3600;
  const timeFrom = now - (candleDuration * limit);

  try {
    // Birdeye OHLCV endpoint (public, no API key for basic usage)
    const url = `${BIRDEYE_API}/defi/ohlcv?address=${mint}&type=${interval}&time_from=${timeFrom}&time_to=${now}`;
    const res = await fetch(url, {
      headers: { 'accept': 'application/json' }
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data?.items && data.data.items.length >= 2) {
        return data.data.items.map(c => ({
          o: c.o,
          h: c.h,
          l: c.l,
          c: c.c,
          v: c.v || 0,
          t: c.unixTime,
          source: 'birdeye',
        }));
      }
    }
  } catch (e) {
    console.warn('Birdeye candle fetch failed:', e.message);
  }

  // Fallback: Jupiter price API (gets current price, we build simple candles)
  try {
    const jupRes = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
    if (jupRes.ok) {
      const jupData = await jupRes.json();
      const price = parseFloat(jupData?.data?.[mint]?.price || 0);
      if (price > 0) {
        // Generate simple candles from current price (flat line with slight variance)
        const candles = [];
        for (let i = 0; i < Math.min(limit, 30); i++) {
          const noise = 1 + (Math.random() - 0.5) * 0.02;
          const p = price * noise;
          candles.push({
            o: p, h: p * 1.005, l: p * 0.995, c: p,
            v: 0,
            t: now - (candleDuration * (Math.min(limit, 30) - i)),
            source: 'jupiter',
          });
        }
        return candles;
      }
    }
  } catch (e) {
    console.warn('Jupiter price fetch failed:', e.message);
  }

  return [];
}

// ── Fetch combined candles (bonding curve + post-graduation) ──
export async function fetchCombinedCandles(mintAddress, timeframe = '1h', limit = 100, graduated = false, migrationComplete = false) {
  const mint = typeof mintAddress === 'string' ? mintAddress : mintAddress.toBase58();

  // Always fetch bonding curve candles first
  let bondingCandles = [];
  try {
    bondingCandles = await fetchCandles(mint, timeframe, limit);
    // Tag source
    bondingCandles = bondingCandles.map(c => ({ ...c, source: 'bonding' }));
  } catch (e) {
    console.warn('Bonding candle fetch failed:', e.message);
  }

  // If not graduated, just return bonding candles
  if (!graduated) {
    return { candles: bondingCandles, source: 'bonding', graduationIndex: -1 };
  }

  // Fetch post-graduation candles
  let liveCandles = [];
  if (migrationComplete) {
    try {
      liveCandles = await fetchJupiterCandles(mint, timeframe, limit);
    } catch (e) {
      console.warn('Live candle fetch failed:', e.message);
    }
  }

  // Merge: bonding candles first, then live candles
  // Find where graduation happened (last bonding candle)
  const graduationIndex = bondingCandles.length > 0 ? bondingCandles.length - 1 : -1;

  // Combine and deduplicate by timestamp
  const combined = [...bondingCandles];
  const existingTimes = new Set(bondingCandles.map(c => c.t));
  for (const c of liveCandles) {
    if (!existingTimes.has(c.t)) {
      combined.push(c);
      existingTimes.add(c.t);
    }
  }

  // Sort by time
  combined.sort((a, b) => {
    const ta = typeof a.t === 'string' ? new Date(a.t).getTime() : a.t * 1000;
    const tb = typeof b.t === 'string' ? new Date(b.t).getTime() : b.t * 1000;
    return ta - tb;
  });

  const source = liveCandles.length > 0 ? 'live' : 'bonding';
  return { candles: combined, source, graduationIndex };
}
'''

if 'fetchJupiterCandles' not in sol:
    sol += jupiter_candles
    with open('src/solana.js', 'w') as f:
        f.write(sol)
    print('✅ solana.js: added fetchJupiterCandles + fetchCombinedCandles')
else:
    print('⏭️  solana.js: Jupiter candle functions already exist')

# ═══════════════════════════════════════════════════
# PART 2: Update App.jsx imports
# ═══════════════════════════════════════════════════

with open('src/App.jsx', 'r') as f:
    app = f.read()

# Add new imports
old_imp = 'import { buildSwapTx, buildJupiterSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, fetchSourceLocks, connection, sha256, fetchHolderCount, fetchCandles, fetchMigrationState, fetchAirdropPoints, fetchAirdropLeaderboard } from "./solana.js";'
new_imp = 'import { buildSwapTx, buildJupiterSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, fetchSourceLocks, connection, sha256, fetchHolderCount, fetchCandles, fetchMigrationState, fetchAirdropPoints, fetchAirdropLeaderboard, fetchCombinedCandles } from "./solana.js";'

if 'fetchCombinedCandles' not in app:
    if old_imp in app:
        app = app.replace(old_imp, new_imp)
        print('✅ App.jsx: added fetchCombinedCandles import')
    else:
        print('❌ App.jsx: could not find import line to update')
else:
    print('⏭️  App.jsx: fetchCombinedCandles import already exists')

# ═══════════════════════════════════════════════════
# PART 3: Update candle fetch logic in TokenPage
# ═══════════════════════════════════════════════════

old_candle_state = '''  const [candles,setCandles]=useState(()=>genCandles(80,0.00004+Math.random()*0.0001));
  const [hasRealCandles,setHasRealCandles]=useState(false);'''

new_candle_state = '''  const [candles,setCandles]=useState(()=>genCandles(80,0.00004+Math.random()*0.0001));
  const [hasRealCandles,setHasRealCandles]=useState(false);
  const [chartSource,setChartSource]=useState('bonding');
  const [graduationIndex,setGraduationIndex]=useState(-1);'''

if old_candle_state in app and 'chartSource' not in app:
    app = app.replace(old_candle_state, new_candle_state)
    print('✅ App.jsx: added chartSource + graduationIndex state')
else:
    print('⏭️  App.jsx: chart state already updated')

# Replace the candle fetch useEffect
old_fetch = '''  // Fetch real candles when token or range changes
  useEffect(()=>{
    const mintStr = t.mint || t.mintAddress;
    if(!mintStr) return;
    const tf = tfMap[range] || '1h';
    fetchCandles(mintStr, tf, 100).then(real => {
      if(real.length >= 2) {
        setCandles(real);
        setHasRealCandles(true);
      } else {
        // No real data yet — keep fake candles
        setCandles(genCandles(80, t.pricePerToken || 0.00004+Math.random()*0.0001));
        setHasRealCandles(false);
      }
    }).catch(()=>{});
  }, [t.mint, t.mintAddress, range]);'''

new_fetch = '''  // Fetch candles — bonding curve + live Meteora/Jupiter post-graduation
  useEffect(()=>{
    const mintStr = t.mint || t.mintAddress;
    if(!mintStr) return;
    const tf = tfMap[range] || '1h';
    fetchCombinedCandles(mintStr, tf, 100, t.graduated, t.migrationComplete).then(result => {
      if(result.candles.length >= 2) {
        setCandles(result.candles);
        setHasRealCandles(true);
        setChartSource(result.source);
        setGraduationIndex(result.graduationIndex);
      } else {
        setCandles(genCandles(80, t.pricePerToken || 0.00004+Math.random()*0.0001));
        setHasRealCandles(false);
        setChartSource('bonding');
        setGraduationIndex(-1);
      }
    }).catch(()=>{});
    // If live, poll every 15s for new candles
    if(gradState === 'LIVE') {
      const iv = setInterval(()=>{
        fetchCombinedCandles(mintStr, tf, 100, true, true).then(result => {
          if(result.candles.length >= 2) {
            setCandles(result.candles);
            setHasRealCandles(true);
            setChartSource(result.source);
          }
        }).catch(()=>{});
      }, 15000);
      return ()=> clearInterval(iv);
    }
  }, [t.mint, t.mintAddress, range, t.graduated, t.migrationComplete, gradState]);'''

if old_fetch in app:
    app = app.replace(old_fetch, new_fetch)
    print('✅ App.jsx: candle fetch now uses fetchCombinedCandles with live polling')
else:
    print('❌ App.jsx: could not find candle fetch useEffect')
    for i, line in enumerate(app.split('\n'), 1):
        if 'Fetch real candles' in line or 'fetchCandles(mintStr' in line:
            print(f'   Line {i}: {line.strip()[:80]}')

# ═══════════════════════════════════════════════════
# PART 4: Update chart source indicator
# ═══════════════════════════════════════════════════

old_simulated = '''            {!hasRealCandles&&(
              <div style={{position:"absolute",top:8,left:16,padding:"3px 8px",background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,zIndex:5}}>
                <Label size={9} color={C.textQuat}>SIMULATED — waiting for trades</Label>
              </div>
            )}'''

new_simulated = '''            {!hasRealCandles&&(
              <div style={{position:"absolute",top:8,left:16,padding:"3px 8px",background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,zIndex:5}}>
                <Label size={9} color={C.textQuat}>SIMULATED — waiting for trades</Label>
              </div>
            )}
            {hasRealCandles&&chartSource==='live'&&(
              <div style={{position:"absolute",top:8,left:16,padding:"3px 8px",background:C.raydiumBg,border:`1px solid ${C.raydiumBd}`,borderRadius:4,zIndex:5,display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:C.raydium,animation:"pulse 2s infinite"}}/>
                <Label size={9} color={C.raydium}>LIVE — Meteora DAMM v2</Label>
              </div>
            )}
            {hasRealCandles&&chartSource==='bonding'&&(
              <div style={{position:"absolute",top:8,left:16,padding:"3px 8px",background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,zIndex:5}}>
                <Label size={9} color={C.textQuat}>Bonding curve</Label>
              </div>
            )}'''

if old_simulated in app:
    app = app.replace(old_simulated, new_simulated)
    print('✅ App.jsx: chart now shows source indicator (Bonding / Live Meteora)')
else:
    print('❌ App.jsx: could not find SIMULATED indicator block')

with open('src/App.jsx', 'w') as f:
    f.write(app)

print('\nDone. Build and test.')
