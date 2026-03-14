/**
 * SUMMIT.MOON Migration Bot (Escrow PDA version)
 *
 * Flow:
 *   1. Poll for graduated pools with no Supabase graduated_pools row
 *   2. Call prepare_migration on-chain (fees → wallets, SOL+tokens → escrow PDA)
 *   3. Call release_escrow on-chain (escrow → bot wallet for Meteora creation)
 *   4. Create Meteora DAMM v2 pool via SDK (initialize_customizable_pool)
 *   5. Permanently lock LP position
 *   6. Update Supabase graduated_pools status = 'live'
 *
 * Key design: Funds never leave program custody until release_escrow.
 * Bot orchestrates but only briefly holds funds for Meteora pool creation.
 *
 * ENV VARS:
 *   RPC_URL              — Solana RPC (Helius recommended)
 *   BOT_KEYPAIR          — Path to bot wallet keypair JSON
 *   PROGRAM_ID           — SUMMIT.MOON program ID
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key (NOT anon key)
 *   PORT                 — Health check port (default 3001)
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const fs = require('fs');
const http = require('http');

// ============================================================
// CONFIG
// ============================================================

const RPC_URL = process.env.RPC_URL || 'https://devnet.helius-rpc.com/?api-key=058c5cbb-e6d6-4f09-a110-aaa298b485c1';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'GHpQrg55uW5Yo97HtrARaDCznA5cxfwW96tySRiRcPWb');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhhplcgfhrtjyruvlqkx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const METEORA_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const PORT = parseInt(process.env.PORT || '3001');
const POLL_INTERVAL = 10_000; // 10 seconds
const MIN_BOT_SOL = 0.1 * LAMPORTS_PER_SOL;

// Load bot keypair
const botKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.BOT_KEYPAIR || './bot-keypair.json', 'utf8')))
);

// ============================================================
// PROGRAM SETUP
// ============================================================

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = new Wallet(botKeypair);
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Minimal IDL for the 3 migration instructions
const IDL = {
    version: "0.1.0",
    name: "pump",
    instructions: [
        {
            name: "prepareMigration",
            accounts: [
                { name: "pool", isMut: true, isSigner: false },
                { name: "globalAccount", isMut: true, isSigner: false },
                { name: "dexConfigurationAccount", isMut: false, isSigner: false },
                { name: "escrow", isMut: true, isSigner: false },
                { name: "poolTokenAccount", isMut: true, isSigner: false },
                { name: "escrowTokenAccount", isMut: true, isSigner: false },
                { name: "coinMint", isMut: true, isSigner: false },
                { name: "protocolWallet", isMut: true, isSigner: false },
                { name: "airdropWallet", isMut: true, isSigner: false },
                { name: "holderWallet", isMut: true, isSigner: false },
                { name: "bot", isMut: true, isSigner: true },
                { name: "tokenProgram", isMut: false, isSigner: false },
                { name: "associatedTokenProgram", isMut: false, isSigner: false },
                { name: "systemProgram", isMut: false, isSigner: false },
            ],
            args: [],
        },
        {
            name: "releaseEscrow",
            accounts: [
                { name: "pool", isMut: false, isSigner: false },
                { name: "escrow", isMut: true, isSigner: false },
                { name: "escrowTokenAccount", isMut: true, isSigner: false },
                { name: "botTokenAccount", isMut: true, isSigner: false },
                { name: "coinMint", isMut: true, isSigner: false },
                { name: "bot", isMut: true, isSigner: true },
                { name: "tokenProgram", isMut: false, isSigner: false },
                { name: "systemProgram", isMut: false, isSigner: false },
            ],
            args: [],
        },
    ],
    accounts: [],
};

const program = new Program(IDL, PROGRAM_ID, provider);

// ============================================================
// PDA HELPERS
// ============================================================

function getPoolPDA(mint) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('liquidity_pool'), mint.toBuffer()],
        PROGRAM_ID
    );
}

function getGlobalPDA() {
    return PublicKey.findProgramAddressSync([Buffer.from('global')], PROGRAM_ID);
}

function getConfigPDA() {
    return PublicKey.findProgramAddressSync([Buffer.from('CurveConfiguration')], PROGRAM_ID);
}

function getEscrowPDA(mint) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('migration_escrow'), mint.toBuffer()],
        PROGRAM_ID
    );
}

// ============================================================
// SUPABASE HELPERS
// ============================================================

async function supabaseQuery(method, path, body = null) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=minimal' : 'return=representation',
    };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 201 && res.status !== 204) {
        const text = await res.text();
        throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') return null;
    return res.json();
}

async function getGraduatedPool(mint) {
    const rows = await supabaseQuery('GET', `graduated_pools?mint=eq.${mint}&select=*`);
    return rows && rows.length > 0 ? rows[0] : null;
}

async function insertGraduatedPool(data) {
    return supabaseQuery('POST', 'graduated_pools', data);
}

async function updateGraduatedPool(mint, data) {
    return supabaseQuery('PATCH', `graduated_pools?mint=eq.${mint}`, data);
}

// ============================================================
// STEP 1: prepare_migration
// ============================================================

async function step1_prepareMigration(mint, protocolWallet, airdropWallet) {
    console.log(`\n  [1/5] prepare_migration for ${mint.toBase58()}`);

    const [poolPDA] = getPoolPDA(mint);
    const [globalPDA, globalBump] = getGlobalPDA();
    const [configPDA] = getConfigPDA();
    const [escrowPDA] = getEscrowPDA(mint);

    const poolTokenAccount = await getAssociatedTokenAddress(mint, globalPDA, true);
    const escrowTokenAccount = await getAssociatedTokenAddress(mint, escrowPDA, true);

    // Holder wallet = protocol wallet for V1
    const holderWallet = protocolWallet;

    const tx = await program.methods
        .prepareMigration()
        .accounts({
            pool: poolPDA,
            globalAccount: globalPDA,
            dexConfigurationAccount: configPDA,
            escrow: escrowPDA,
            poolTokenAccount: poolTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            coinMint: mint,
            protocolWallet: protocolWallet,
            airdropWallet: airdropWallet,
            holderWallet: holderWallet,
            bot: botKeypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log(`    ✅ prepare_migration tx: ${tx}`);
    return tx;
}

// ============================================================
// STEP 2: release_escrow
// ============================================================

async function step2_releaseEscrow(mint) {
    console.log(`  [2/5] release_escrow for ${mint.toBase58()}`);

    const [poolPDA] = getPoolPDA(mint);
    const [escrowPDA] = getEscrowPDA(mint);

    const escrowTokenAccount = await getAssociatedTokenAddress(mint, escrowPDA, true);
    const botTokenAccount = await getAssociatedTokenAddress(mint, botKeypair.publicKey);

    // Ensure bot has ATA for this mint
    const ataInfo = await connection.getAccountInfo(botTokenAccount);
    if (!ataInfo) {
        console.log('    Creating bot token account...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            botKeypair.publicKey,
            botTokenAccount,
            botKeypair.publicKey,
            mint,
        );
        const tx = new Transaction().add(createAtaIx);
        await provider.sendAndConfirm(tx);
    }

    const tx = await program.methods
        .releaseEscrow()
        .accounts({
            pool: poolPDA,
            escrow: escrowPDA,
            escrowTokenAccount: escrowTokenAccount,
            botTokenAccount: botTokenAccount,
            coinMint: mint,
            bot: botKeypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log(`    ✅ release_escrow tx: ${tx}`);
    return tx;
}

// ============================================================
// STEP 3: Create Meteora Pool (initialize_customizable_pool)
// ============================================================

async function step3_createMeteoraPool(mint) {
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
}

// ============================================================
// STEP 4: Lock LP Permanently
// ============================================================

async function step4_lockLP(meteoraPool, positionNft) {
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
}

// ============================================================
// FULL MIGRATION FLOW
// ============================================================

async function runMigration(mint, protocolWallet, airdropWallet) {
    const mintStr = mint.toBase58();

    try {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  MIGRATING: ${mintStr}`);
        console.log(`${'═'.repeat(60)}`);

        // Check if already in Supabase
        let row = await getGraduatedPool(mintStr);

        // ── STEP 1: prepare_migration ──
        if (!row) {
            const escrowTx = await step1_prepareMigration(mint, protocolWallet, airdropWallet);
            await insertGraduatedPool({
                mint: mintStr,
                status: 'pending',
                escrow_tx: escrowTx,
                graduated_at: new Date().toISOString(),
            });
            row = await getGraduatedPool(mintStr);
        } else if (row.status === 'failed') {
            // Retry failed migration from step 1
            const escrowTx = await step1_prepareMigration(mint, protocolWallet, airdropWallet);
            await updateGraduatedPool(mintStr, {
                status: 'pending',
                escrow_tx: escrowTx,
                error_msg: null,
                failed_at: null,
            });
            row = await getGraduatedPool(mintStr);
        }

        // ── STEP 2: release_escrow ──
        if (!row.pool_create_tx) {
            const releaseTx = await step2_releaseEscrow(mint);
            // Don't store release tx separately — it's part of the flow
        }

        // ── STEP 3: Create Meteora pool ──
        if (!row.meteora_pool) {
            const result = await step3_createMeteoraPool(mint);

            if (!result) {
                console.log('\n  ⚠️  Meteora SDK not wired. Stopping. Funds in bot wallet.');
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
        }

        // ── STEP 5: Mark live ──
        await updateGraduatedPool(mintStr, {
            status: 'live',
            migrated_at: new Date().toISOString(),
        });

        console.log(`\n  ✅ MIGRATION COMPLETE: ${mintStr}`);
        console.log(`  Pool live on Meteora. LP locked forever.\n`);

    } catch (err) {
        console.error(`\n  ❌ MIGRATION FAILED: ${mintStr}`);
        console.error(`     ${err.message}`);

        try {
            await updateGraduatedPool(mintStr, {
                status: 'failed',
                failed_at: new Date().toISOString(),
                error_msg: err.message.slice(0, 500),
            });
        } catch (dbErr) {
            console.error('     Failed to update Supabase:', dbErr.message);
        }
    }
}

// ============================================================
// WATCHER: Poll for graduated pools
// ============================================================

async function pollForGraduations() {
    try {
        // LiquidityPool ACCOUNT_SIZE from state.rs
        const POOL_SIZE = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 8 + 8 + 32 + 1 + 16;

        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            filters: [{ dataSize: POOL_SIZE }],
        });

        for (const { pubkey, account } of accounts) {
            // graduated bool at offset: 8(disc) + 32 + 32 + 8 + 8 + 8 + 1 + 8 = 105
            const graduated = account.data[105] === 1;
            if (!graduated) continue;

            // Extract mint (token_one) at offset 8..40
            const mint = new PublicKey(account.data.slice(8, 40));
            const mintStr = mint.toBase58();

            // Check Supabase — skip if already live
            const row = await getGraduatedPool(mintStr);
            if (row && row.status === 'live') continue;

            console.log(`\n  🎓 Graduated pool found: ${mintStr}`);

            // Read config for wallet addresses
            const [configPDA] = getConfigPDA();
            const configAccount = await connection.getAccountInfo(configPDA);
            if (!configAccount) {
                console.error('  ❌ Config account not found');
                continue;
            }

            // CurveConfiguration: 8(disc) + 8(fees) + 32(protocol) + 32(airdrop) + 32(antivamp)
            const protocolWallet = new PublicKey(configAccount.data.slice(16, 48));
            const airdropWallet = new PublicKey(configAccount.data.slice(48, 80));

            await runMigration(mint, protocolWallet, airdropWallet);
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }
}

// ============================================================
// HEALTH CHECK SERVER
// ============================================================

async function checkHealth() {
    const balance = await connection.getBalance(botKeypair.publicKey);
    const healthy = balance >= MIN_BOT_SOL;
    return {
        status: healthy ? 'ok' : 'low_balance',
        bot_wallet: botKeypair.publicKey.toBase58(),
        sol_balance: (balance / LAMPORTS_PER_SOL).toFixed(4),
        program_id: PROGRAM_ID.toBase58(),
        rpc: RPC_URL.includes('helius') ? 'helius' : 'default',
    };
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
        try {
            const health = await checkHealth();
            const status = health.status === 'ok' ? 200 : 500;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', error: err.message }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log('🚀 SUMMIT.MOON Migration Bot (Escrow PDA v2)');
    console.log(`   RPC: ${RPC_URL.slice(0, 40)}...`);
    console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
    console.log(`   Bot wallet: ${botKeypair.publicKey.toBase58()}`);

    const balance = await connection.getBalance(botKeypair.publicKey);
    console.log(`   SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}`);

    if (balance < MIN_BOT_SOL) {
        console.warn('   ⚠️  Low balance! Bot needs at least 0.1 SOL for tx fees.');
    }

    if (!SUPABASE_SERVICE_KEY) {
        console.warn('   ⚠️  SUPABASE_SERVICE_KEY not set — Supabase writes will fail.');
    }

    // Start health check server
    server.listen(PORT, () => {
        console.log(`   Health check: http://localhost:${PORT}/health`);
    });

    // Poll immediately, then every 10 seconds
    await pollForGraduations();
    setInterval(pollForGraduations, POLL_INTERVAL);

    console.log(`\n  👂 Polling every ${POLL_INTERVAL / 1000}s. Ctrl+C to stop.\n`);
}

main().catch(console.error);
