#!/usr/bin/env python3
"""Wire Meteora DAMM v2 SDK into migration-bot/index.js step3 + step4"""

with open('migration-bot/index.js', 'r') as f:
    content = f.read()

# ── Replace step3_createMeteoraPool ──
old_step3 = '''async function step3_createMeteoraPool(mint) {
    console.log(`  [3/5] Creating Meteora DAMM v2 pool...`);

    // Get bot balances
    const solBalance = await connection.getBalance(botKeypair.publicKey);
    const botTokenAccount = await getAssociatedTokenAddress(mint, botKeypair.publicKey);
    const tokenInfo = await connection.getTokenAccountBalance(botTokenAccount);
    const tokenAmount = parseInt(tokenInfo.value.amount);
    const solForPool = solBalance - (0.05 * LAMPORTS_PER_SOL); // Keep 0.05 SOL for fees

    console.log(`    SOL for pool: ${(solForPool / LAMPORTS_PER_SOL).toFixed(4)}`);
    console.log(`    Tokens for pool: ${tokenAmount}`);

    // ════════════════════════════════════════════════════
    // METEORA SDK: initialize_customizable_pool
    // No config key needed — permissionless pool creation
    //
    // const { CpAmm } = require('@meteora-ag/cp-amm-sdk');
    // const cpAmm = new CpAmm(connection);
    //
    // // Wrap SOL to wSOL first
    // // ... (createWrappedNativeAccount or syncNative)
    //
    // const positionNftMint = Keypair.generate();
    //
    // const { pool, tx } = await cpAmm.createCustomizablePool({
    //     payer: botKeypair.publicKey,
    //     creator: botKeypair.publicKey,
    //     positionNft: positionNftMint.publicKey,
    //     tokenAMint: mint,
    //     tokenBMint: WSOL_MINT,
    //     tokenAAmount: new BN(tokenAmount),
    //     tokenBAmount: new BN(solForPool),
    //     // Full range constant product (no concentrated liquidity)
    //     // Use SDK constants for min/max sqrt price
    // });
    //
    // await provider.sendAndConfirm(tx, [botKeypair, positionNftMint]);
    // return { poolAddress: pool, positionNft: positionNftMint.publicKey };
    // ════════════════════════════════════════════════════

    console.log('    ⏳ Meteora SDK not wired yet — pool creation stubbed');
    console.log('    Use initialize_customizable_pool (no config key needed)');
    return null;
}'''

new_step3 = '''async function step3_createMeteoraPool(mint) {
    console.log(`  [3/5] Creating Meteora DAMM v2 pool...`);

    const { CpAmm } = require('@meteora-ag/cp-amm-sdk');
    const { createSyncNativeInstruction, NATIVE_MINT } = require('@solana/spl-token');

    // Get bot balances
    const solBalance = await connection.getBalance(botKeypair.publicKey);
    const botTokenAccount = await getAssociatedTokenAddress(mint, botKeypair.publicKey);
    const tokenInfo = await connection.getTokenAccountBalance(botTokenAccount);
    const tokenAmount = parseInt(tokenInfo.value.amount);
    const solForPool = solBalance - Math.floor(0.05 * LAMPORTS_PER_SOL); // Keep 0.05 SOL for fees

    if (solForPool <= 0) throw new Error(`Not enough SOL for pool. Balance: ${solBalance}`);
    if (tokenAmount <= 0) throw new Error(`No tokens in bot wallet for pool creation.`);

    console.log(`    SOL for pool: ${(solForPool / LAMPORTS_PER_SOL).toFixed(4)}`);
    console.log(`    Tokens for pool: ${tokenAmount}`);

    // ── Wrap SOL → wSOL ──
    const wsolAta = await getAssociatedTokenAddress(WSOL_MINT, botKeypair.publicKey);
    const wsolInfo = await connection.getAccountInfo(wsolAta);

    const wrapTx = new Transaction();
    if (!wsolInfo) {
        wrapTx.add(createAssociatedTokenAccountInstruction(
            botKeypair.publicKey, wsolAta, botKeypair.publicKey, WSOL_MINT
        ));
    }
    wrapTx.add(SystemProgram.transfer({
        fromPubkey: botKeypair.publicKey,
        toPubkey: wsolAta,
        lamports: solForPool,
    }));
    wrapTx.add(createSyncNativeInstruction(wsolAta));
    await provider.sendAndConfirm(wrapTx, [botKeypair]);
    console.log(`    wSOL wrapped: ${(solForPool / LAMPORTS_PER_SOL).toFixed(4)}`);

    // ── Create Meteora DAMM v2 pool ──
    const cpAmm = new CpAmm(connection);
    const positionNftMint = Keypair.generate();

    // Token ordering: Meteora requires tokenA < tokenB by pubkey bytes
    const mintBytes = mint.toBuffer();
    const wsolBytes = WSOL_MINT.toBuffer();
    const mintFirst = Buffer.compare(mintBytes, wsolBytes) < 0;

    const tokenAMint = mintFirst ? mint : WSOL_MINT;
    const tokenBMint = mintFirst ? WSOL_MINT : mint;
    const tokenAAmount = new BN(mintFirst ? tokenAmount.toString() : solForPool.toString());
    const tokenBAmount = new BN(mintFirst ? solForPool.toString() : tokenAmount.toString());

    console.log(`    Token A: ${tokenAMint.toBase58().slice(0,8)}... (${tokenAAmount.toString()})`);
    console.log(`    Token B: ${tokenBMint.toBase58().slice(0,8)}... (${tokenBAmount.toString()})`);

    const createPoolTx = await cpAmm.createPool({
        payer: botKeypair.publicKey,
        creator: botKeypair.publicKey,
        positionNft: positionNftMint.publicKey,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        tokenAAmount: tokenAAmount,
        tokenBAmount: tokenBAmount,
    });

    const sig = await provider.sendAndConfirm(createPoolTx.tx, [botKeypair, positionNftMint]);
    console.log(`    ✅ Meteora pool created: ${createPoolTx.pool.toBase58()}`);
    console.log(`    Pool tx: ${sig}`);

    return {
        poolAddress: createPoolTx.pool,
        positionNft: positionNftMint.publicKey,
        txSig: sig,
        solMigrated: solForPool,
        tokensMigrated: tokenAmount,
    };
}'''

# ── Replace step4_lockLP ──
old_step4 = '''async function step4_lockLP(meteoraPool, positionNft) {
    console.log(`  [4/5] Permanently locking LP...`);

    // ════════════════════════════════════════════════════
    // METEORA SDK: permanent_lock_position
    //
    // const lockTx = await cpAmm.permanentLockPosition({
    //     pool: meteoraPool,
    //     position: positionNft,
    //     owner: botKeypair.publicKey,
    // });
    // await provider.sendAndConfirm(lockTx, [botKeypair]);
    // ════════════════════════════════════════════════════

    console.log('    ⏳ LP lock stubbed — wire Meteora SDK');
    return null;
}'''

new_step4 = '''async function step4_lockLP(meteoraPool, positionNft) {
    console.log(`  [4/5] Permanently locking LP...`);

    const { CpAmm } = require('@meteora-ag/cp-amm-sdk');
    const cpAmm = new CpAmm(connection);

    const poolKey = typeof meteoraPool === 'string' ? new PublicKey(meteoraPool) : meteoraPool;
    const nftKey = typeof positionNft === 'string' ? new PublicKey(positionNft) : positionNft;

    const lockTx = await cpAmm.lockPosition({
        pool: poolKey,
        position: nftKey,
        owner: botKeypair.publicKey,
    });

    const sig = await provider.sendAndConfirm(lockTx, [botKeypair]);
    console.log(`    ✅ LP permanently locked. tx: ${sig}`);
    return sig;
}'''

# ── Also fix the runMigration function to pass results properly ──
old_run_step3 = '''        // ── STEP 3: Create Meteora pool ──
        if (!row.meteora_pool) {
            const result = await step3_createMeteoraPool(mint);

            if (!result) {
                console.log('\\n  ⚠️  Meteora SDK not wired. Stopping. Funds in bot wallet.');
                console.log('  Fill in step3_createMeteoraPool() and restart bot.');
                return;
            }

            await updateGraduatedPool(mintStr, {
                meteora_pool: result.poolAddress.toBase58(),
                pool_create_tx: 'TODO', // Replace with actual tx sig
                sol_migrated: 0, // Replace with actual
                tokens_migrated: 0, // Replace with actual
            });
        }

        // ── STEP 4: Lock LP ──
        if (!row.lp_lock_tx) {
            const lockTx = await step4_lockLP(row.meteora_pool, null);
            if (lockTx) {
                await updateGraduatedPool(mintStr, { lp_lock_tx: lockTx });
            }
        }'''

new_run_step3 = '''        // ── STEP 3: Create Meteora pool ──
        let meteoraResult = null;
        if (!row.meteora_pool) {
            meteoraResult = await step3_createMeteoraPool(mint);

            await updateGraduatedPool(mintStr, {
                meteora_pool: meteoraResult.poolAddress.toBase58(),
                pool_create_tx: meteoraResult.txSig,
                sol_migrated: meteoraResult.solMigrated,
                tokens_migrated: meteoraResult.tokensMigrated,
                position_nft: meteoraResult.positionNft.toBase58(),
            });
            row = await getGraduatedPool(mintStr);
        }

        // ── STEP 4: Lock LP ──
        if (!row.lp_lock_tx) {
            const nft = meteoraResult ? meteoraResult.positionNft : (row.position_nft ? new PublicKey(row.position_nft) : null);
            if (!nft) {
                console.warn('    ⚠️  No position NFT found — cannot lock LP');
            } else {
                const lockTx = await step4_lockLP(row.meteora_pool, nft);
                if (lockTx) {
                    await updateGraduatedPool(mintStr, { lp_lock_tx: lockTx });
                }
            }
        }'''

# Apply replacements
for old, new, label in [(old_step3, new_step3, 'step3'), (old_step4, new_step4, 'step4'), (old_run_step3, new_run_step3, 'runMigration')]:
    if old in content:
        content = content.replace(old, new)
        print(f'  ✅ {label} replaced')
    else:
        print(f'  ❌ {label} not found — manual edit needed')

with open('migration-bot/index.js', 'w') as f:
    f.write(content)

print('\nDone. Run: cd migration-bot && npm install @meteora-ag/cp-amm-sdk')
