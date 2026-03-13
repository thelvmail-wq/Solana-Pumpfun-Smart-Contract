#!/usr/bin/env python3
"""
UI improvements:
1. Fetch source lock status from Supabase for each token
2. Show "VERIFIED" / "SOURCE LOCKED" badge on feed cards
3. Social links already show on ScannerFeed TokenRow — already clickable
"""

# ── Part 1: Update solana.js to fetch source lock status ──
path_sol = "frontend/src/solana.js"
with open(path_sol, "r") as f:
    sol_content = f.read()

# Add fetchSourceLocks function before fetchDeployedTokens
new_func = '''
// ── Fetch source locks from Supabase ──────────────────────────
export async function fetchSourceLocks() {
  const data = await supabaseGet('source_locks', 'select=mint,canonical_key,source_hash,created_at&order=created_at.desc')
  const map = {}
  for (const lock of data) {
    map[lock.mint] = {
      canonicalKey: lock.canonical_key,
      sourceHash: lock.source_hash,
      lockedAt: lock.created_at,
    }
  }
  return map
}

'''

marker_sol = "// ══════════════════════════════════════════════════════════════\n// Fetch all TokenRegistry accounts"
if marker_sol in sol_content:
    sol_content = sol_content.replace(marker_sol, new_func + marker_sol)
    print("✅ solana.js: Added fetchSourceLocks function")
else:
    print("⚠️  solana.js: marker not found")

with open(path_sol, "w") as f:
    f.write(sol_content)

# ── Part 2: Update App.jsx ──
path_app = "frontend/src/App.jsx"
with open(path_app, "r") as f:
    app_content = f.read()

changes = 0

# Edit A: Add fetchSourceLocks to import
old_import = "import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, connection, sha256, fetchHolderCount, fetchCandles } from \"./solana.js\";"
new_import = "import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, fetchSourceLocks, connection, sha256, fetchHolderCount, fetchCandles } from \"./solana.js\";"
if old_import in app_content:
    app_content = app_content.replace(old_import, new_import)
    changes += 1
    print("✅ App.jsx Edit A: Added fetchSourceLocks to import")
else:
    print("⚠️  App.jsx Edit A: import not found")

# Edit B: Fetch source locks in the main token loading effect and merge into token data
old_load = '''    const load = () => fetchAllTokensWithPools().then(onChain=>{
      if(onChain.length>0){
        setTokens(onChain);
        setPlatformVol(onChain.reduce((a,t)=>a+(t.volRaw||0),0));
      }
    }).catch(e=>console.error("fetch tokens error:",e));'''

new_load = '''    const load = async () => {
      try {
        const [onChain, locks] = await Promise.all([
          fetchAllTokensWithPools(),
          fetchSourceLocks(),
        ]);
        if(onChain.length>0){
          const enriched = onChain.map(t => {
            const lock = locks[t.mint];
            if (lock) {
              return { ...t, sourceLocked: true, sourceKey: lock.canonicalKey, sourceLockedAt: lock.lockedAt };
            }
            return { ...t, sourceLocked: false };
          });
          setTokens(enriched);
          setPlatformVol(enriched.reduce((a,t)=>a+(t.volRaw||0),0));
        }
      } catch(e) {
        console.error("fetch tokens error:",e);
      }
    };'''

if old_load in app_content:
    app_content = app_content.replace(old_load, new_load)
    changes += 1
    print("✅ App.jsx Edit B: Added source lock fetch to token loading")
else:
    print("⚠️  App.jsx Edit B: token loading block not found")

# Edit C: Add VERIFIED badge to ScannerFeed TokenRow
# Find the existing NEW badge and add VERIFIED badge before it
old_badge = '''              {isNew&&<span style={{fontSize:7,fontWeight:800,color:C.green,background:"rgba(34,197,94,0.15)",borderRadius:2,padding:"0 4px",lineHeight:"12px"}}>NEW</span>}'''

new_badge = '''              {t.sourceLocked&&(
                <span title={"Source: " + (t.sourceKey||"")} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:7,fontWeight:700,color:C.gold,background:"rgba(201,168,76,0.12)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:3,padding:"1px 4px",lineHeight:"11px",cursor:"default"}}>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M12 1l3.09 6.26L22 8.27l-5 4.87L18.18 20 12 16.77 5.82 20 7 13.14l-5-4.87 6.91-1.01L12 1z"/></svg>
                  VERIFIED
                </span>
              )}
              {!t.sourceLocked&&t.isProtected&&(
                <span style={{fontSize:7,fontWeight:700,color:C.purple,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:3,padding:"1px 4px",lineHeight:"11px"}}>PVP</span>
              )}
              {isNew&&<span style={{fontSize:7,fontWeight:800,color:C.green,background:"rgba(34,197,94,0.15)",borderRadius:2,padding:"0 4px",lineHeight:"12px"}}>NEW</span>}'''

if old_badge in app_content:
    app_content = app_content.replace(old_badge, new_badge)
    changes += 1
    print("✅ App.jsx Edit C: Added VERIFIED + PVP badges to feed cards")
else:
    print("⚠️  App.jsx Edit C: NEW badge block not found")

# Edit D: Add source lock info to token page header (next to MC)
# Find the nav bar area in TokenPage where social links are
old_nav_badge = '''          {t.topicLocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:6,padding:"2px 8px"}}><Label size={10} color={C.teal}>{t.topicSource} -- {t.topicTitle?.slice(0,36)}</Label></div>}'''

new_nav_badge = '''          {t.sourceLocked&&<div style={{background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:6,padding:"2px 8px",display:"flex",alignItems:"center",gap:4}}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M12 1l3.09 6.26L22 8.27l-5 4.87L18.18 20 12 16.77 5.82 20 7 13.14l-5-4.87 6.91-1.01L12 1z"/></svg>
            <Label size={10} color={C.gold} weight={600}>Source Verified</Label>
          </div>}
          {t.topicLocked&&!t.sourceLocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:6,padding:"2px 8px"}}><Label size={10} color={C.teal}>{t.topicSource} -- {t.topicTitle?.slice(0,36)}</Label></div>}'''

if old_nav_badge in app_content:
    app_content = app_content.replace(old_nav_badge, new_nav_badge)
    changes += 1
    print("✅ App.jsx Edit D: Added Source Verified badge to token page header")
else:
    print("⚠️  App.jsx Edit D: topicLocked nav badge not found")

# Edit E: Add source lock info section in the swap panel (below contract address)
old_contract = '''          <button onClick={()=>{navigator.clipboard.writeText(t.mint);}} style={{background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",cursor:"pointer",flexShrink:0}}>
            <Label size={9} color={C.textTer}>Copy</Label>
          </button>
        </div>
      </div>'''

new_contract = '''          <button onClick={()=>{navigator.clipboard.writeText(t.mint);}} style={{background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",cursor:"pointer",flexShrink:0}}>
            <Label size={9} color={C.textTer}>Copy</Label>
          </button>
        </div>

        {/* Source verification status */}
        {t.sourceLocked&&(
          <div style={{marginTop:8,background:"rgba(201,168,76,0.06)",border:`1px solid rgba(201,168,76,0.15)`,borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M12 1l3.09 6.26L22 8.27l-5 4.87L18.18 20 12 16.77 5.82 20 7 13.14l-5-4.87 6.91-1.01L12 1z"/></svg>
            <div>
              <Label size={10} color={C.gold} weight={600} style={{display:"block"}}>Source Verified</Label>
              <Label size={9} color={C.textTer}>{t.sourceKey || "On-chain source lock active"}</Label>
            </div>
          </div>
        )}
        {!t.sourceLocked&&(
          <div style={{marginTop:8,background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
            <Label size={9} color={C.textQuat}>Standard launch — no source verification</Label>
          </div>
        )}
      </div>'''

if old_contract in app_content:
    app_content = app_content.replace(old_contract, new_contract)
    changes += 1
    print("✅ App.jsx Edit E: Added source lock status to swap panel")
else:
    print("⚠️  App.jsx Edit E: Contract address block not found")

with open(path_app, "w") as f:
    f.write(app_content)

print(f"\n✅ {changes} edits applied to App.jsx")
print("Run: git add . && git commit -m 'UI: verified badges + source lock status on cards and token page' && git push")
