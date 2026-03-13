#!/usr/bin/env python3
"""
Apply 3 anti-vamp edits to App.jsx:
1. Update ANTIVAMP_URL
2. Update /canonicalize call with mint+creator
3. Update /confirm-lock call with new fields
"""

import sys

path = "frontend/src/App.jsx"
with open(path, "r") as f:
    content = f.read()

# ── EDIT 1: Update ANTIVAMP_URL ──
old1 = "const ANTIVAMP_URL = 'https://summit-antivamp.up.railway.app'; // Update after Railway deploy"
new1 = "const ANTIVAMP_URL = 'https://solana-pumpfun-smart-contract-production.up.railway.app';"

if old1 in content:
    content = content.replace(old1, new1)
    print("✅ Edit 1: ANTIVAMP_URL updated")
else:
    print("⚠️  Edit 1: ANTIVAMP_URL string not found (may already be updated)")

# ── EDIT 2: Update /canonicalize call ──
old2 = """      const avRes = await fetch(`${ANTIVAMP_URL}/canonicalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: form.topicUrl, image_base64: imgB64, ticker: tkr }),
      }).then(r => r.json()).catch(() => null);"""

new2 = """      const avRes = await fetch(`${ANTIVAMP_URL}/canonicalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: form.topicUrl,
          image_base64: imgB64,
          mint: mk.publicKey.toBase58(),
          creator: provider.publicKey.toBase58(),
        }),
      }).then(r => r.json()).catch(() => null);"""

if old2 in content:
    content = content.replace(old2, new2)
    print("✅ Edit 2: /canonicalize payload updated with mint+creator")
else:
    print("⚠️  Edit 2: /canonicalize block not found exactly")

# ── EDIT 3: Update /confirm-lock call ──
old3 = """      await fetch(`${ANTIVAMP_URL}/confirm-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_key: antiVampResult.canonical_key,
          mint: mk.publicKey.toBase58(),
          phash: antiVampResult.image_phash,
        }),
      });
      console.log("Source lock confirmed:", antiVampResult.canonical_key);"""

new3 = """      await fetch(`${ANTIVAMP_URL}/confirm-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_hash: antiVampResult.source_hash,
          canonical_key: antiVampResult.canonical_key,
          mint: mk.publicKey.toBase58(),
          creator: provider.publicKey.toBase58(),
          image_phash: antiVampResult.image_phash,
          tx_sig: sig1,
        }),
      });
      console.log("Source lock confirmed in cache:", antiVampResult.canonical_key);"""

if old3 in content:
    content = content.replace(old3, new3)
    print("✅ Edit 3: /confirm-lock payload updated with new fields")
else:
    print("⚠️  Edit 3: /confirm-lock block not found exactly")

# ── EDIT 3b: Update the console log after canonicalize ──
old3b = 'console.log("Anti-vamp approved:", avRes.canonical_key);'
new3b = 'console.log("Anti-vamp approved:", avRes.canonical_key, "expires:", avRes.expiry_timestamp);'

if old3b in content:
    content = content.replace(old3b, new3b)
    print("✅ Edit 3b: Anti-vamp log updated")

with open(path, "w") as f:
    f.write(content)

print("\n✅ All edits applied to", path)
print("Run: git add . && git commit -m 'frontend: update anti-vamp to 112-byte signature' && git push")
