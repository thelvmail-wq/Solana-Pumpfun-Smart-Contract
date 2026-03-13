#!/usr/bin/env python3
"""
Simplify deploy form:
1. Remove the "News or tweet URL" field
2. Make Twitter field detect tweet URLs and trigger source lock
3. Make Website field trigger source lock for articles
4. Remove topicUrl from form state and all topic-related UI
"""

path = "frontend/src/App.jsx"
with open(path, "r") as f:
    content = f.read()

changes = 0

# ── EDIT 1: Update form state — remove topicUrl ──
old1 = 'const [form,setForm]=useState({name:"",sym:"",desc:"",twitter:"",website:"",topicUrl:"",imageFile:null});'
new1 = 'const [form,setForm]=useState({name:"",sym:"",desc:"",twitter:"",website:"",imageFile:null});'
if old1 in content:
    content = content.replace(old1, new1)
    changes += 1
    print("✅ Edit 1: Removed topicUrl from form state")
else:
    print("⚠️  Edit 1: form state not found")

# ── EDIT 2: Update the anti-vamp call in deploy to use twitter/website ──
# Find the existing anti-vamp block that references form.topicUrl
old2 = '''  // Call anti-vamp backend if source URL provided
  // Must happen after TX1 because we need the mint address
  let antiVampResult = null;
  if (form.topicUrl && form.topicUrl.trim().length > 5) {
    try {
      const imgB64 = form.imageFile ? btoa(String.fromCharCode(...new Uint8Array(await form.imageFile.arrayBuffer()).slice(0, 10000))) : null;
      const avRes = await fetch(`${ANTIVAMP_URL}/canonicalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: form.topicUrl,
          image_base64: imgB64,
          mint: mk.publicKey.toBase58(),
          creator: provider.publicKey.toBase58(),
        }),
      }).then(r => r.json()).catch(() => null);
      
      if (avRes?.error) {
        throw new Error(`Anti-vamp: ${avRes.error}`);
      }
      if (avRes?.source_hash) {
        antiVampResult = avRes;
        console.log("Anti-vamp approved:", avRes.canonical_key, "expires:", avRes.expiry_timestamp);
      }
    } catch(avErr) {
      console.warn("Anti-vamp check skipped:", avErr.message);
      // Non-fatal — deploy continues without source lock
    }
  }'''

new2 = '''  // Detect source URL from twitter or website fields
  // Tweet URL in twitter field → source lock + identity lock
  // Article URL in website field → source lock + identity lock
  let sourceUrl = null;
  const twVal = (form.twitter || '').trim();
  const webVal = (form.website || '').trim();
  if (twVal.includes('x.com/') || twVal.includes('twitter.com/')) {
    if (twVal.includes('/status/')) sourceUrl = twVal; // It's a tweet URL
  }
  if (!sourceUrl && webVal.length > 5 && webVal.includes('.') && webVal.includes('/')) {
    sourceUrl = webVal; // Article URL from website field
  }

  // Call anti-vamp backend if source URL detected
  let antiVampResult = null;
  if (sourceUrl) {
    try {
      const imgB64 = form.imageFile ? btoa(String.fromCharCode(...new Uint8Array(await form.imageFile.arrayBuffer()).slice(0, 10000))) : null;
      const avRes = await fetch(`${ANTIVAMP_URL}/canonicalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: sourceUrl,
          image_base64: imgB64,
          mint: mk.publicKey.toBase58(),
          creator: provider.publicKey.toBase58(),
        }),
      }).then(r => r.json()).catch(() => null);
      
      if (avRes?.error) {
        throw new Error(`Anti-vamp: ${avRes.error}`);
      }
      if (avRes?.source_hash) {
        antiVampResult = avRes;
        console.log("Anti-vamp approved:", avRes.canonical_key, "expires:", avRes.expiry_timestamp);
      }
    } catch(avErr) {
      console.warn("Anti-vamp check skipped:", avErr.message);
    }
  }'''

if old2 in content:
    content = content.replace(old2, new2)
    changes += 1
    print("✅ Edit 2: Updated anti-vamp to detect source from twitter/website")
else:
    print("⚠️  Edit 2: Anti-vamp block not found exactly")

# ── EDIT 3: Remove the handleUrl function and topic classifying state ──
old3 = '''  const [topicRes,setTopicRes]=useState(null);
  const [classifying,setClassifying]=useState(false);'''
new3 = '''  const [topicRes,setTopicRes]=useState(null);'''
if old3 in content:
    content = content.replace(old3, new3)
    changes += 1
    print("✅ Edit 3: Removed classifying state")
else:
    print("⚠️  Edit 3: classifying state not found")

# ── EDIT 4: Remove the "News or tweet URL" input field and its feedback ──
# Find the topic URL input block
old4 = '''          <div style={{marginBottom:8}}>
            <input value={form.topicUrl} onChange={e=>handleUrl(e.target.value)} placeholder="News or tweet URL (locks topic)"
              style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1.5px solid ${topicRes?.claimed?C.redBd:topicRes&&!topicRes.claimed?C.tealBd:C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color 0.15s, background 0.15s"}}
              onFocus={e=>{e.target.style.background="rgba(255,255,255,0.06)";}}
              onBlur={e=>{e.target.style.background="rgba(255,255,255,0.04)";}}/>
            {classifying&&form.topicUrl.length>0&&<Label size={11} color={C.textTer} style={{display:"block",marginTop:6}}>Classifying...</Label>}
            {topicRes&&!classifying&&form.topicUrl.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:topicRes.claimed?C.redBg:C.tealBg,border:`1px solid ${topicRes.claimed?C.redBd:C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:topicRes.claimed?C.red:C.teal,flexShrink:0}}/>
                {topicRes.claimed
                  ?<Label size={11} color={C.red}>Topic claimed by <strong>{topicRes.claimedBy}</strong> for 24h -- use a different URL.</Label>
                  :<Label size={11} color={C.teal}>{topicRes.entity} via {topicRes.source} -- locks on deploy</Label>}
              </div>
            )}
          </div>'''

new4 = ''  # Remove entirely

if old4 in content:
    content = content.replace(old4, new4)
    changes += 1
    print("✅ Edit 4: Removed topic URL input field")
else:
    print("⚠️  Edit 4: Topic URL input block not found exactly")

# ── EDIT 5: Update the /check call in handleUrl to use twitter field ──
# Find the handleUrl function and replace with a simpler version that checks twitter field
# First, find and remove the old handleUrl function
import re
# Match from 'const handleUrl=async' to the closing '};' 
old5_pattern = r'  const handleUrl=async\(url\)=>\{.*?\n  \};'
match = re.search(old5_pattern, content, re.DOTALL)
if match:
    content = content[:match.start()] + '''  // Check source URL availability when twitter field changes
  const checkSourceUrl = async (url) => {
    if (!url || url.trim().length < 10) { setTopicRes(null); return; }
    const s = url.trim().toLowerCase();
    // Only check if it looks like a tweet URL or article URL
    const isTweet = (s.includes('x.com/') || s.includes('twitter.com/')) && s.includes('/status/');
    const isArticle = s.includes('.') && s.includes('/') && !s.includes('x.com') && !s.includes('twitter.com');
    if (!isTweet && !isArticle) { setTopicRes(null); return; }
    
    try {
      const checkRes = await fetch(`${ANTIVAMP_URL}/check?url=${encodeURIComponent(url)}`).then(r=>r.json()).catch(()=>null);
      if (checkRes) {
        if (!checkRes.available && checkRes.locked_by) {
          setTopicRes({ claimed: true, claimedBy: checkRes.locked_by.slice(0,8)+'...', source: 'on-chain', entity: checkRes.canonical_key });
        } else if (checkRes.available && checkRes.canonical_key) {
          const parts = checkRes.canonical_key.split(':');
          const source = parts[0] === 'x' ? 'X/Twitter' : 'Article';
          setTopicRes({ claimed: false, source, entity: checkRes.canonical_key, lockable: checkRes.lockable });
        } else if (!checkRes.lockable) {
          setTopicRes({ claimed: false, source: 'expired', entity: checkRes.reason || 'Not lockable', invalid: true });
        } else {
          setTopicRes(null);
        }
      } else {
        setTopicRes(null);
      }
    } catch(e) {
      setTopicRes(null);
    }
  };''' + content[match.end():]
    changes += 1
    print("✅ Edit 5: Replaced handleUrl with checkSourceUrl")
else:
    print("⚠️  Edit 5: handleUrl function not found")

# ── EDIT 6: Update twitter field onChange to also call checkSourceUrl ──
old6 = 'onChange={e=>setForm(p=>({...p,twitter:e.target.value}))} placeholder="@twitter or x.com/handle — required for PVP lock"'
new6 = 'onChange={e=>{setForm(p=>({...p,twitter:e.target.value}));checkSourceUrl(e.target.value);}} placeholder="@twitter or tweet URL (x.com/.../status/...) — locks source + identity"'
if old6 in content:
    content = content.replace(old6, new6)
    changes += 1
    print("✅ Edit 6: Updated twitter field to call checkSourceUrl")
else:
    print("⚠️  Edit 6: Twitter field onChange not found")

# ── EDIT 7: Update website field onChange to also call checkSourceUrl ──
old7 = 'onChange={e=>setForm(p=>({...p,website:e.target.value}))} placeholder="Website URL — required for PVP lock"'
new7 = 'onChange={e=>{setForm(p=>({...p,website:e.target.value}));checkSourceUrl(e.target.value);}} placeholder="Website or article URL — locks source + identity"'
if old7 in content:
    content = content.replace(old7, new7)
    changes += 1
    print("✅ Edit 7: Updated website field to call checkSourceUrl")
else:
    print("⚠️  Edit 7: Website field onChange not found")

# ── EDIT 8: Add source lock feedback under twitter field ──
# Find the existing twitter identity feedback and add source lock info
old8 = '''            {!twitterClaim&&twitterIdentity&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}>Identity <strong style={{color:C.text}}>{twitterIdentity}</strong> locks to this CA -- all derivatives blocked</Label>
              </div>
            )}'''

new8 = '''            {!twitterClaim&&twitterIdentity&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}>Identity <strong style={{color:C.text}}>{twitterIdentity}</strong> locks to this CA -- all derivatives blocked</Label>
              </div>
            )}
            {topicRes&&!topicRes.claimed&&topicRes.source==='X/Twitter'&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:4,padding:"8px 11px",background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.gold,flexShrink:0}}/>
                <Label size={11} color={C.gold}>Source lock: <strong style={{color:C.text}}>{topicRes.entity}</strong> — first deployer wins on-chain</Label>
              </div>
            )}
            {topicRes&&topicRes.claimed&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:4,padding:"8px 11px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.red,flexShrink:0}}/>
                <Label size={11} color={C.red}>Source already claimed by <strong style={{color:C.text}}>{topicRes.claimedBy}</strong></Label>
              </div>
            )}
            {topicRes&&topicRes.invalid&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:4,padding:"8px 11px",background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,borderRadius:9}}>
                <Label size={11} color={C.textTer}>{topicRes.entity}</Label>
              </div>
            )}'''

if old8 in content:
    content = content.replace(old8, new8)
    changes += 1
    print("✅ Edit 8: Added source lock feedback under twitter field")
else:
    print("⚠️  Edit 8: Twitter identity feedback block not found")

# ── EDIT 9: Remove topicBlocked from deploy blocked check ──
old9 = '  const topicBlocked = (topicRes&&topicRes.claimed) || !!twitterClaim || !!websiteClaim;'
new9 = '  const topicBlocked = !!twitterClaim || !!websiteClaim || (topicRes&&topicRes.claimed);'
if old9 in content:
    content = content.replace(old9, new9)
    changes += 1
    print("✅ Edit 9: Updated topicBlocked logic")
else:
    print("⚠️  Edit 9: topicBlocked not found")

# ── EDIT 10: Remove topicRes references in the "done" state ──
old10 = '        {topicRes&&!deployBlocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:10,padding:"10px 12px",marginBottom:16,textAlign:"left"}}><Label size={12} color={C.teal} weight={600}>Verified topic locked -- {topicRes.source} / {topicRes.entity}</Label></div>}'
new10 = '        {topicRes&&!topicRes.claimed&&!deployBlocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:10,padding:"10px 12px",marginBottom:16,textAlign:"left"}}><Label size={12} color={C.teal} weight={600}>Source verified -- {topicRes.source} / {topicRes.entity}</Label></div>}'
if old10 in content:
    content = content.replace(old10, new10)
    changes += 1
    print("✅ Edit 10: Updated topic display in done state")
else:
    print("⚠️  Edit 10: topicRes done state not found")

with open(path, "w") as f:
    f.write(content)

print(f"\n✅ {changes} edits applied to {path}")
print("Run: git add . && git commit -m 'frontend: simplify deploy - source lock via twitter/website fields' && git push")
