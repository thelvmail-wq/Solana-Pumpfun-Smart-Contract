#!/usr/bin/env python3
"""
Add create_source_lock transaction to the deploy flow in App.jsx.
Inserts TX between claim_locks and FULL DEPLOY COMPLETE.
Also updates the import to include buildCreateSourceLockTx.
"""

path = "frontend/src/App.jsx"
with open(path, "r") as f:
    content = f.read()

# ── EDIT 1: Add buildCreateSourceLockTx to import ──
old_import = "import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, fetchDeployedTokens, fetchAllTokensWithPools, connection, sha256, fetchHolderCount, fetchCandles } from \"./solana.js\";"
new_import = "import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, connection, sha256, fetchHolderCount, fetchCandles } from \"./solana.js\";"

if old_import in content:
    content = content.replace(old_import, new_import)
    print("✅ Edit 1: Added buildCreateSourceLockTx to import")
else:
    print("⚠️  Edit 1: Import not found exactly")

# ── EDIT 2: Add source lock TX after claim_locks in deploy flow ──
old_block = '''  console.log("FULL DEPLOY COMPLETE");

  // Confirm anti-vamp lock in Supabase cache after successful deploy'''

new_block = '''  // ── TX5: Create source lock on-chain (if anti-vamp was used) ──
  if (antiVampResult && antiVampResult.source_hash) {
    try {
      const txSL = await buildCreateSourceLockTx(provider.publicKey, mk.publicKey, antiVampResult);
      txSL.add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
      txSL.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
      const bhSL = await connection.getLatestBlockhash("confirmed");
      txSL.recentBlockhash = bhSL.blockhash;
      txSL.feePayer = provider.publicKey;
      const rSL = await provider.signAndSendTransaction(txSL);
      const sigSL = rSL.signature || rSL;
      console.log("SourceLock TX:", sigSL);
      await confirmAndVerify(sigSL, "SourceLock");
      console.log("Source lock created on-chain ✅");
    } catch(slErr) {
      console.warn("Source lock failed (non-fatal):", slErr.message);
      // Non-fatal — the token still deploys, just without on-chain source verification
    }
  }

  console.log("FULL DEPLOY COMPLETE");

  // Confirm anti-vamp lock in Supabase cache after successful deploy'''

if old_block in content:
    content = content.replace(old_block, new_block)
    print("✅ Edit 2: Added source lock TX to deploy flow")
else:
    print("⚠️  Edit 2: Deploy flow block not found exactly")

with open(path, "w") as f:
    f.write(content)

print("\n✅ All edits applied to", path)
print("Run: git add . && git commit -m 'frontend: add source lock TX to deploy flow' && git push")
