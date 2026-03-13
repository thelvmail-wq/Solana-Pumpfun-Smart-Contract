#!/usr/bin/env python3
"""
Polish the Source Verified UI:
1. Token page: Move source lock to top, big banner, clickable link, clear messaging
2. Feed cards: Better badge with "LOCKED" text
3. Swap panel: Cleaner source status
"""

path = "frontend/src/App.jsx"
with open(path, "r") as f:
    content = f.read()

changes = 0

# ── EDIT 1: Update feed card badge from "VERIFIED" to "VERIFIED & LOCKED" with better styling ──
old1 = '''              {t.sourceLocked&&(
                <span title={"Source: " + (t.sourceKey||"")} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:7,fontWeight:700,color:C.gold,background:"rgba(201,168,76,0.12)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:3,padding:"1px 4px",lineHeight:"11px",cursor:"default"}}>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M12 1l3.09 6.26L22 8.27l-5 4.87L18.18 20 12 16.77 5.82 20 7 13.14l-5-4.87 6.91-1.01L12 1z"/></svg>
                  VERIFIED
                </span>
              )}'''

new1 = '''              {t.sourceLocked&&(
                <span title={"Source: " + (t.sourceKey||"")} style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:7,fontWeight:800,color:"#000",background:"linear-gradient(135deg,#c9a84c,#e6c65a)",borderRadius:3,padding:"2px 6px",lineHeight:"11px",cursor:"default",letterSpacing:"0.04em",boxShadow:"0 1px 4px rgba(201,168,76,0.3)"}}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="#000" stroke="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                  LOCKED
                </span>
              )}'''

if old1 in content:
    content = content.replace(old1, new1)
    changes += 1
    print("✅ Edit 1: Updated feed badge to LOCKED with gold gradient")
else:
    print("⚠️  Edit 1: Feed badge not found")

# ── EDIT 2: Update token page header badge ──
old2 = '''          {t.sourceLocked&&<div style={{background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:6,padding:"2px 8px",display:"flex",alignItems:"center",gap:4}}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M12 1l3.09 6.26L22 8.27l-5 4.87L18.18 20 12 16.77 5.82 20 7 13.14l-5-4.87 6.91-1.01L12 1z"/></svg>
            <Label size={10} color={C.gold} weight={600}>Source Verified</Label>
          </div>}'''

new2 = '''          {t.sourceLocked&&<div style={{background:"linear-gradient(135deg,rgba(201,168,76,0.15),rgba(201,168,76,0.05))",border:`1px solid rgba(201,168,76,0.35)`,borderRadius:6,padding:"3px 10px",display:"flex",alignItems:"center",gap:5}}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            <Label size={10} color={C.gold} weight={700}>Source Locked</Label>
          </div>}'''

if old2 in content:
    content = content.replace(old2, new2)
    changes += 1
    print("✅ Edit 2: Updated token page header badge")
else:
    print("⚠️  Edit 2: Token page header badge not found")

# ── EDIT 3: Replace the small source status in swap panel with a big prominent banner ──
old3 = '''        {/* Source verification status */}
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
        )}'''

# Extract domain from sourceKey for favicon
new3 = '''        {/* Source verification status */}
        {t.sourceLocked&&(()=>{
          const sk = t.sourceKey || "";
          const isArticle = sk.startsWith("article:");
          const isTweet = sk.startsWith("x:");
          const domain = isArticle ? sk.replace("article:","").split("/")[0] : isTweet ? "x.com" : "";
          const fullUrl = isArticle ? "https://" + sk.replace("article:","") : isTweet ? "https://x.com/i/status/" + sk.replace("x:","") : "";
          return (
            <div style={{marginTop:10,background:"linear-gradient(135deg,rgba(201,168,76,0.1),rgba(201,168,76,0.03))",border:`1px solid rgba(201,168,76,0.25)`,borderRadius:10,padding:"14px",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:28,height:28,borderRadius:7,background:"rgba(201,168,76,0.15)",border:"1px solid rgba(201,168,76,0.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                </div>
                <div>
                  <Label size={13} color={C.gold} weight={700} style={{display:"block"}}>Source Verified & Locked</Label>
                  <Label size={10} color={C.textTer}>First mover — no duplicates can deploy this source</Label>
                </div>
              </div>
              {fullUrl&&(
                <a href={fullUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"rgba(0,0,0,0.2)",borderRadius:8,textDecoration:"none",transition:"background 0.12s",cursor:"pointer"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,0.35)"}
                  onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0.2)"}>
                  {domain&&<img src={"https://www.google.com/s2/favicons?domain="+domain+"&sz=32"} width="16" height="16" style={{borderRadius:3,flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>}
                  <div style={{flex:1,minWidth:0}}>
                    <Label size={10} color={C.textSec} style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sk}</Label>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textTer} strokeWidth="2" style={{flexShrink:0}}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              )}
            </div>
          );
        })()}
        {!t.sourceLocked&&(
          <div style={{marginTop:10,background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,borderRadius:10,padding:"12px",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:24,height:24,borderRadius:6,background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textQuat} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <div>
              <Label size={11} color={C.textTer} weight={500} style={{display:"block"}}>Standard Launch</Label>
              <Label size={9} color={C.textQuat}>No source verification — anyone can deploy similar tokens</Label>
            </div>
          </div>
        )}'''

if old3 in content:
    content = content.replace(old3, new3)
    changes += 1
    print("✅ Edit 3: Replaced source status with big prominent banner + clickable link")
else:
    print("⚠️  Edit 3: Source status block not found")

# ── EDIT 4: Add source lock banner at top of sidebar (before airdrop gate) ──
old4 = '''          {t.bondingFull&&(
            <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:"rgba(255,214,10,0.04)"}}>
              <AirdropGate t={t}/>
            </div>
          )}'''

new4 = '''          {/* Source lock banner — top of sidebar */}
          {t.sourceLocked&&(
            <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:"linear-gradient(135deg,rgba(201,168,76,0.08),rgba(201,168,76,0.02))"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:24,height:24,borderRadius:6,background:"rgba(201,168,76,0.15)",border:"1px solid rgba(201,168,76,0.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={C.gold} stroke="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                </div>
                <div style={{flex:1}}>
                  <Label size={12} color={C.gold} weight={700}>Source Verified & Locked</Label>
                  <Label size={9} color={C.textTer} style={{display:"block",marginTop:1}}>First deployer — this source cannot be duplicated</Label>
                </div>
              </div>
            </div>
          )}

          {t.bondingFull&&(
            <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:"rgba(255,214,10,0.04)"}}>
              <AirdropGate t={t}/>
            </div>
          )}'''

if old4 in content:
    content = content.replace(old4, new4)
    changes += 1
    print("✅ Edit 4: Added source lock banner at top of sidebar")
else:
    print("⚠️  Edit 4: Airdrop gate block not found")

with open(path, "w") as f:
    f.write(content)

print(f"\n✅ {changes} edits applied to {path}")
print("Run: git add . && git commit -m 'UI: polished source lock - LOCKED badge, banner, clickable links' && git push")
