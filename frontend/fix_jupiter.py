#!/usr/bin/env python3
"""
Add Jupiter swap routing for post-graduation tokens.
1. Adds buildJupiterSwapTx() to solana.js
2. Updates SwapPanel in App.jsx to route based on graduation status
"""

# ═══════════════════════════════════════════════════
# PART 1: Add Jupiter swap to solana.js
# ═══════════════════════════════════════════════════

with open('src/solana.js', 'r') as f:
    sol_content = f.read()

jupiter_code = '''

// ── Jupiter swap for post-graduation tokens ───────────────────
// Routes through Jupiter aggregator with 150bps platform fee
// Used when token has migrated to Meteora (graduated + migrationComplete)
const JUPITER_API = 'https://quote-api.jup.ag/v6';
const PLATFORM_FEE_BPS = 150; // 1.5% partner fee
const PLATFORM_FEE_WALLET = 'CgAxuV2LvSmG26C4FGjMpVJApkDEbBpyReXbCvJP9tBF'; // protocol wallet — change for mainnet
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function buildJupiterSwapTx(walletPubkey, mintAddress, solAmount, isBuy) {
  const user = walletPubkey instanceof PublicKey ? walletPubkey : new PublicKey(walletPubkey);
  const mint = typeof mintAddress === 'string' ? mintAddress : mintAddress.toBase58();

  const inputMint = isBuy ? SOL_MINT : mint;
  const outputMint = isBuy ? mint : SOL_MINT;
  const amount = isBuy
    ? Math.floor(solAmount * 1e9) // SOL to lamports
    : Math.floor(solAmount);      // token raw amount

  // 1. Get quote
  const quoteUrl = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=300&platformFeeBps=${PLATFORM_FEE_BPS}`;
  const quoteRes = await fetch(quoteUrl);
  if (!quoteRes.ok) {
    const err = await quoteRes.text();
    throw new Error(`Jupiter quote failed: ${err}`);
  }
  const quote = await quoteRes.json();

  if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
    throw new Error('No Jupiter route found for this token. It may not have Meteora liquidity yet.');
  }

  // 2. Get serialized transaction
  const swapRes = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user.toBase58(),
      wrapAndUnwrapSol: true,
      feeAccount: PLATFORM_FEE_WALLET,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!swapRes.ok) {
    const err = await swapRes.text();
    throw new Error(`Jupiter swap failed: ${err}`);
  }

  const swapData = await swapRes.json();

  if (swapData.error) {
    throw new Error(`Jupiter swap error: ${swapData.error}`);
  }

  // 3. Deserialize the transaction
  const { VersionedTransaction } = await import('@solana/web3.js');
  const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);

  return {
    tx,
    quote,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    priceImpactPct: quote.priceImpactPct,
    isVersioned: true,
  };
}
'''

if 'buildJupiterSwapTx' not in sol_content:
    sol_content += jupiter_code
    with open('src/solana.js', 'w') as f:
        f.write(sol_content)
    print('✅ solana.js: added buildJupiterSwapTx')
else:
    print('⏭️  solana.js: buildJupiterSwapTx already exists')

# ═══════════════════════════════════════════════════
# PART 2: Update SwapPanel in App.jsx to route swaps
# ═══════════════════════════════════════════════════

with open('src/App.jsx', 'r') as f:
    app_content = f.read()

# Add Jupiter import to the top import line
old_import = 'import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, fetchSourceLocks, connection, sha256, fetchHolderCount, fetchCandles, fetchMigrationState } from "./solana.js";'
new_import = 'import { buildSwapTx, buildJupiterSwapTx, buildCreateRegistryTx, buildClaimLocksTx, buildCreateSourceLockTx, fetchDeployedTokens, fetchAllTokensWithPools, fetchSourceLocks, connection, sha256, fetchHolderCount, fetchCandles, fetchMigrationState } from "./solana.js";'

if 'buildJupiterSwapTx' not in app_content:
    app_content = app_content.replace(old_import, new_import)
    print('✅ App.jsx: added buildJupiterSwapTx import')
else:
    print('⏭️  App.jsx: import already exists')

# Now update the swap execution in SwapPanel
# Find the existing swap handler and replace with one that routes based on graduation
old_swap_handler = '''const mintPk=new (await import('@solana/web3.js')).PublicKey(mintStr);
          const tx=await buildSwapTx(provider.publicKey,mintPk,parseFloat(amt),tab==="buy");
          tx.feePayer=provider.publicKey;
          const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
          tx.recentBlockhash=blockhash;
          const signed=await provider.signTransaction(tx);
          const sig=await connection.sendRawTransaction(signed.serialize());
          const result=await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},"confirmed");
          if(result?.value?.err){
            throw new Error("Transaction failed on-chain. You may have insufficient SOL or the pool state changed.");
          }'''

new_swap_handler = '''const mintPk=new (await import('@solana/web3.js')).PublicKey(mintStr);
          const isGraduated = t.migrationComplete || t.graduated;
          if (isGraduated) {
            // Post-graduation: route through Jupiter with 1.5% platform fee
            console.log("Routing through Jupiter (post-graduation)...");
            const jupResult = await buildJupiterSwapTx(provider.publicKey, mintStr, tab==="buy" ? parseFloat(amt) : parseFloat(amt), tab==="buy");
            const signed = await provider.signTransaction(jupResult.tx);
            const sig = await connection.sendRawTransaction(signed.serialize(), {skipPreflight:true});
            const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
            const result=await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},"confirmed");
            if(result?.value?.err) throw new Error("Jupiter swap failed on-chain.");
          } else {
            // Pre-graduation: use bonding curve
            const tx=await buildSwapTx(provider.publicKey,mintPk,parseFloat(amt),tab==="buy");
            tx.feePayer=provider.publicKey;
            const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
            tx.recentBlockhash=blockhash;
            const signed=await provider.signTransaction(tx);
            const sig=await connection.sendRawTransaction(signed.serialize());
            const result=await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},"confirmed");
            if(result?.value?.err) throw new Error("Transaction failed on-chain. You may have insufficient SOL or the pool state changed.");
          }'''

if old_swap_handler in app_content:
    app_content = app_content.replace(old_swap_handler, new_swap_handler)
    print('✅ App.jsx: SwapPanel now routes graduated tokens through Jupiter')
else:
    print('❌ App.jsx: Could not find swap handler — manual edit needed')
    # Show what we're looking for
    if 'buildSwapTx(provider.publicKey,mintPk' in app_content:
        print('   Found buildSwapTx call but surrounding code differs')
        import re
        for i, line in enumerate(app_content.split('\n'), 1):
            if 'buildSwapTx(provider.publicKey,mintPk' in line:
                print(f'   Line {i}: {line.strip()[:80]}')
    else:
        print('   buildSwapTx call not found at all')

with open('src/App.jsx', 'w') as f:
    f.write(app_content)

print('\nDone. Build and test.')
