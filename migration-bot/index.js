/**
 * SUMMIT.MOON Migration Bot
 * 
 * Watches for graduated pools and handles the full migration flow:
 *   1. Call prepare_migration on-chain (extract SOL + tokens, distribute fees)
 *   2. Create Meteora DAMM v2 pool via TypeScript SDK
 *   3. Permanently lock LP position
 *   4. Call confirm_migration on-chain (store Meteora pool address)
 * 
 * ENV VARS:
 *   RPC_URL          — Solana RPC (Helius recommended)
 *   BOT_KEYPAIR      — Path to bot wallet keypair JSON (this is the migration_authority)
 *   PROGRAM_ID       — SUMMIT.MOON program ID
 *   HELIUS_API_KEY   — For WebSocket subscriptions
 *   METEORA_CONFIG   — Meteora config key pubkey (get from Meteora team)
 * 
 * INSTALL:
 *   npm install @solana/web3.js @coral-xyz/anchor @meteora-ag/cp-amm-sdk
 * 
 * RUN:
 *   node migration-bot.js
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const fs = require('fs');

// ============================================================
// CONFIG
// ============================================================

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx');
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '058c5cbb-e6d6-4f09-a110-aaa298b485c1';
const METEORA_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Load bot keypair
const botKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.BOT_KEYPAIR || './bot-keypair.json', 'utf8')))
);

console.log(`Bot wallet: ${botKeypair.publicKey.toBase58()}`);

// ============================================================
// PROGRAM SETUP
// ============================================================

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = new Wallet(botKeypair);
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Minimal IDL — just the instructions we need
// You'll replace this with the full IDL after building
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
                { name: "coinMint", isMut: true, isSigner: false },
                { name: "poolTokenAccount", isMut: true, isSigner: false },
                { name: "protocolWallet", isMut: true, isSigner: false },
                { name: "airdropWallet", isMut: true, isSigner: false },
                { name: "holderReserveWallet", isMut: true, isSigner: false },
                { name: "migrationAuthority", isMut: true, isSigner: true },
                { name: "migrationTokenAccount", isMut: true, isSigner: false },
                { name: "tokenProgram", isMut: false, isSigner: false },
                { name: "systemProgram", isMut: false, isSigner: false },
            ],
            args: [],
        },
        {
            name: "confirmMigration",
            accounts: [
                { name: "pool", isMut: true, isSigner: false },
                { name: "coinMint", isMut: false, isSigner: false },
                { name: "dexConfigurationAccount", isMut: false, isSigner: false },
                { name: "admin", isMut: true, isSigner: true },
            ],
            args: [
                { name: "meteoraPool", type: "publicKey" },
            ],
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
    return PublicKey.findProgramAddressSync(
        [Buffer.from('global')],
        PROGRAM_ID
    );
}

function getConfigPDA() {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('CurveConfiguration')],
        PROGRAM_ID
    );
}

// ============================================================
// STEP 1: Prepare Migration (on-chain)
// ============================================================

async function prepareMigration(mint, protocolWallet, airdropWallet) {
    console.log(`\n=== STEP 1: prepare_migration for ${mint.toBase58()} ===`);

    const [poolPDA] = getPoolPDA(mint);
    const [globalPDA] = getGlobalPDA();
    const [configPDA] = getConfigPDA();

    const poolTokenAccount = await getAssociatedTokenAddress(mint, globalPDA, true);
    const migrationTokenAccount = await getAssociatedTokenAddress(mint, botKeypair.publicKey);

    // Ensure bot has a token account for this mint
    const ataInfo = await connection.getAccountInfo(migrationTokenAccount);
    if (!ataInfo) {
        console.log('Creating bot token account...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            botKeypair.publicKey,
            migrationTokenAccount,
            botKeypair.publicKey,
            mint,
        );
        const tx = new (require('@solana/web3.js').Transaction)().add(createAtaIx);
        const sig = await provider.sendAndConfirm(tx);
        console.log(`ATA created: ${sig}`);
    }

    // For now, holder reserve goes to protocol wallet (same destination)
    const holderReserveWallet = protocolWallet;

    const tx = await program.methods
        .prepareMigration()
        .accounts({
            pool: poolPDA,
            globalAccount: globalPDA,
            dexConfigurationAccount: configPDA,
            coinMint: mint,
            poolTokenAccount: poolTokenAccount,
            protocolWallet: protocolWallet,
            airdropWallet: airdropWallet,
            holderReserveWallet: holderReserveWallet,
            migrationAuthority: botKeypair.publicKey,
            migrationTokenAccount: migrationTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: require('@solana/web3.js').SystemProgram.programId,
        })
        .rpc();

    console.log(`prepare_migration tx: ${tx}`);
    return tx;
}

// ============================================================
// STEP 2: Create Meteora Pool (off-chain via SDK)
// ============================================================

async function createMeteoraPool(mint) {
    console.log(`\n=== STEP 2: Create Meteora DAMM v2 pool for ${mint.toBase58()} ===`);

    // Check bot's SOL and token balances
    const solBalance = await connection.getBalance(botKeypair.publicKey);
    const migrationTokenAccount = await getAssociatedTokenAddress(mint, botKeypair.publicKey);
    const tokenAccountInfo = await connection.getTokenAccountBalance(migrationTokenAccount);

    const solAmount = solBalance - 0.01 * LAMPORTS_PER_SOL; // Keep 0.01 SOL for fees
    const tokenAmount = parseInt(tokenAccountInfo.value.amount);

    console.log(`SOL for pool: ${solAmount / LAMPORTS_PER_SOL}`);
    console.log(`Tokens for pool: ${tokenAmount}`);

    // ================================================
    // METEORA SDK INTEGRATION
    // ================================================
    // This is where you use @meteora-ag/cp-amm-sdk
    // The exact code depends on your Meteora config key.
    //
    // Pseudocode:
    //
    //   const { CpAmm } = require('@meteora-ag/cp-amm-sdk');
    //   const cpAmm = new CpAmm(connection);
    //
    //   const positionNftMint = Keypair.generate();
    //
    //   const createPoolTx = await cpAmm.createCustomPool({
    //       payer: botKeypair.publicKey,
    //       creator: botKeypair.publicKey,
    //       // config: METEORA_CONFIG_KEY,   // Get this from Meteora team
    //       positionNft: positionNftMint.publicKey,
    //       tokenAMint: mint,                // Your memecoin
    //       tokenBMint: WSOL_MINT,           // Wrapped SOL
    //       activationPoint: new BN(0),      // Activate immediately
    //       tokenAAmount: new BN(tokenAmount),
    //       tokenBAmount: new BN(solAmount),
    //       // Full range constant product:
    //       minSqrtPrice: MIN_SQRT_PRICE,    // From SDK constants
    //       maxSqrtPrice: MAX_SQRT_PRICE,    // From SDK constants
    //       tokenADecimal: 9,                // Your token decimals
    //       tokenBDecimal: 9,                // SOL decimals
    //       tokenAProgram: TOKEN_PROGRAM_ID,
    //       tokenBProgram: TOKEN_PROGRAM_ID,
    //       // Fee config in the config key:
    //       //   - collectFeeMode: 1 (Token B only = SOL only)
    //       //   - partner fee: configured in your config key
    //   });
    //
    //   // Sign and send
    //   const tx = await createPoolTx.transaction();
    //   tx.sign(botKeypair, positionNftMint);
    //   const sig = await connection.sendRawTransaction(tx.serialize());
    //
    //   // Get the pool address from the SDK
    //   const meteoraPoolAddress = createPoolTx.pool;
    //
    //   return meteoraPoolAddress;
    //
    // ================================================

    // PLACEHOLDER: Replace with actual Meteora SDK calls
    // For now, log what would happen
    console.log('TODO: Wire Meteora SDK createCustomPool here');
    console.log('Need METEORA_CONFIG_KEY from Meteora team first');
    console.log('Pool would be created with:');
    console.log(`  Token A (memecoin): ${mint.toBase58()}`);
    console.log(`  Token B (wSOL): ${WSOL_MINT.toBase58()}`);
    console.log(`  SOL amount: ${solAmount / LAMPORTS_PER_SOL}`);
    console.log(`  Token amount: ${tokenAmount}`);

    // Return null for now — replace with actual pool address
    return null;
}

// ============================================================
// STEP 3: Lock LP Permanently (via Meteora SDK)
// ============================================================

async function lockLPPermanently(meteoraPoolAddress) {
    console.log(`\n=== STEP 3: Permanently lock LP for ${meteoraPoolAddress} ===`);

    // ================================================
    // Meteora SDK: permanent_lock_position
    //
    //   const lockTx = await cpAmm.permanentLockPosition({
    //       pool: meteoraPoolAddress,
    //       position: positionNft,
    //       owner: botKeypair.publicKey,
    //   });
    //   await provider.sendAndConfirm(lockTx);
    //
    // Key insight: After permanent lock, you can STILL
    // claim fees from the position. Liquidity just can't
    // be withdrawn.
    // ================================================

    console.log('TODO: Wire Meteora SDK permanentLockPosition here');
}

// ============================================================
// STEP 4: Confirm Migration (on-chain)
// ============================================================

async function confirmMigration(mint, meteoraPoolAddress) {
    console.log(`\n=== STEP 4: confirm_migration for ${mint.toBase58()} ===`);

    const [poolPDA] = getPoolPDA(mint);
    const [configPDA] = getConfigPDA();

    // NOTE: confirm_migration requires admin (protocol_wallet) as signer.
    // If the bot IS the protocol wallet, this works directly.
    // If not, the bot needs the protocol wallet to sign this tx.

    const tx = await program.methods
        .confirmMigration(meteoraPoolAddress)
        .accounts({
            pool: poolPDA,
            coinMint: mint,
            dexConfigurationAccount: configPDA,
            admin: botKeypair.publicKey, // Must be protocol_wallet
        })
        .rpc();

    console.log(`confirm_migration tx: ${tx}`);
    return tx;
}

// ============================================================
// FULL MIGRATION FLOW
// ============================================================

async function runMigration(mint, protocolWallet, airdropWallet) {
    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`STARTING MIGRATION: ${mint.toBase58()}`);
        console.log(`${'='.repeat(60)}`);

        // Step 1: Extract funds from bonding curve
        await prepareMigration(mint, protocolWallet, airdropWallet);

        // Step 2: Create Meteora pool
        const meteoraPool = await createMeteoraPool(mint);

        if (!meteoraPool) {
            console.log('\n⚠️  Meteora pool creation not yet wired. Stopping here.');
            console.log('Once you have the Meteora config key, fill in createMeteoraPool()');
            return;
        }

        // Step 3: Lock LP permanently
        await lockLPPermanently(meteoraPool);

        // Step 4: Confirm on-chain
        await confirmMigration(mint, meteoraPool);

        console.log(`\n✅ MIGRATION COMPLETE for ${mint.toBase58()}`);
        console.log(`   Meteora pool: ${meteoraPool.toBase58()}`);

    } catch (err) {
        console.error(`\n❌ MIGRATION FAILED for ${mint.toBase58()}:`, err.message);
        console.error(err);
    }
}

// ============================================================
// WATCHER: Poll for graduated pools
// ============================================================

async function pollForGraduations() {
    console.log('\n🔍 Polling for graduated pools...');

    // Fetch all pool accounts
    // Filter for: graduated == true AND meteora_pool == default (not yet migrated)
    //
    // With Anchor, you can use getProgramAccounts with memcmp filters:
    //   - graduated is at byte offset: 8(disc) + 32 + 32 + 8 + 8 + 8 + 1 + 8 = 105
    //     graduated (bool) = byte 105, value 0x01
    //   - meteora_pool is at offset: 105 + 1 + 8 + 32 + 8 + 16 = 170
    //     Actually let's just decode all accounts and filter in JS.

    try {
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            filters: [
                { dataSize: 211 }, // LiquidityPool account size (updated)
            ],
        });

        for (const { pubkey, account } of accounts) {
            // Quick check: graduated byte
            // Offset for graduated: 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 = 105
            const graduated = account.data[105] === 1;

            if (graduated) {
                // Check meteora_pool (32 bytes at offset 105 + 1 + 8 + 32 + 8 + 16 + 8 = 178)
                // Actually: after airdrop_pool(8) + padding(16) + graduation_ts(8) = pool offset 170 + 8 = 178
                // meteora_pool starts at byte 178
                const meteoraPoolBytes = account.data.slice(178, 210);
                const isDefault = meteoraPoolBytes.every(b => b === 0);

                if (isDefault) {
                    // Extract mint (token_one) from bytes 8..40
                    const mintBytes = account.data.slice(8, 40);
                    const mint = new PublicKey(mintBytes);
                    console.log(`\n🎓 Found graduated pool needing migration: ${mint.toBase58()}`);

                    // TODO: Get protocolWallet and airdropWallet from config
                    // For now, read from config PDA
                    const [configPDA] = getConfigPDA();
                    const configAccount = await connection.getAccountInfo(configPDA);
                    if (configAccount) {
                        // CurveConfiguration layout: 8(disc) + 8(fees) + 32(protocol) + 32(airdrop) + 32(antivamp)
                        const protocolWallet = new PublicKey(configAccount.data.slice(16, 48));
                        const airdropWallet = new PublicKey(configAccount.data.slice(48, 80));
                        await runMigration(mint, protocolWallet, airdropWallet);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function main() {
    console.log('🚀 SUMMIT.MOON Migration Bot starting...');
    console.log(`   RPC: ${RPC_URL}`);
    console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
    console.log(`   Bot wallet: ${botKeypair.publicKey.toBase58()}`);

    const botBalance = await connection.getBalance(botKeypair.publicKey);
    console.log(`   Bot SOL balance: ${botBalance / LAMPORTS_PER_SOL}`);

    if (botBalance < 0.01 * LAMPORTS_PER_SOL) {
        console.error('⚠️  Bot wallet needs SOL for transaction fees!');
    }

    // Poll every 10 seconds
    setInterval(pollForGraduations, 10_000);

    // Initial poll
    await pollForGraduations();

    console.log('\n👂 Bot running. Polling every 10 seconds...');
    console.log('   Press Ctrl+C to stop.\n');
}

main().catch(console.error);
