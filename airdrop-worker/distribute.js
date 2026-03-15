/**
 * SUMMIT.MOON Quarterly USDC Distribution Bot
 *
 * Distributes USDC to all holders proportional to their accumulated points.
 * Handles 100K+ wallets by batching transfers.
 *
 * Flow:
 *   1. Calculate quarter boundaries
 *   2. Aggregate points per wallet from airdrop_snapshots
 *   3. Swap airdrop pool SOL → USDC via Jupiter
 *   4. Calculate each wallet's share
 *   5. Send USDC transfers in batches (up to 20 per tx using lookup tables)
 *   6. Track progress in airdrop_payout_batches + airdrop_payouts
 *   7. Resume from where it stopped if interrupted
 *
 * Run: QUARTER=2026-Q1 node distribute.js
 *
 * ENV VARS:
 *   RPC_URL              — Solana RPC
 *   BOT_KEYPAIR          — Path to bot wallet keypair JSON
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   QUARTER              — Quarter to distribute (e.g. '2026-Q1')
 *   DRY_RUN              — Set to 'true' to simulate without sending
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');

const RPC_URL = process.env.RPC_URL || 'https://devnet.helius-rpc.com/?api-key=058c5cbb-e6d6-4f09-a110-aaa298b485c1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhhplcgfhrtjyruvlqkx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const QUARTER = process.env.QUARTER || '';
const DRY_RUN = process.env.DRY_RUN === 'true';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // mainnet USDC
const TRANSFERS_PER_TX = 10; // conservative batch size
const MIN_PAYOUT_USDC = 0.01; // skip dust payouts below 1 cent

const connection = new Connection(RPC_URL, 'confirmed');
const botKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.BOT_KEYPAIR || './bot-keypair.json', 'utf8')))
);

// ── Supabase ──
async function sb(method, path, body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=minimal,resolution=merge-duplicates' : 'return=representation',
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

async function auditLog(action, mint, wallet, details = {}) {
  try {
    await sb('POST', 'airdrop_audit_log', { action, mint, wallet, details, actor: 'payout_bot' });
  } catch (e) { console.warn(`Audit log failed: ${e.message}`); }
}

// ── Quarter boundaries ──
function getQuarterDates(quarter) {
  const [year, q] = quarter.split('-Q');
  const qNum = parseInt(q);
  const startMonth = (qNum - 1) * 3;
  const start = new Date(parseInt(year), startMonth, 1);
  const end = new Date(parseInt(year), startMonth + 3, 0); // last day of quarter
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

// ── Main distribution flow ──
async function distribute() {
  if (!QUARTER) {
    console.error('Set QUARTER env var (e.g. QUARTER=2026-Q1)');
    process.exit(1);
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_KEY not set');
    process.exit(1);
  }

  const { start, end } = getQuarterDates(QUARTER);
  console.log('═══════════════════════════════════════════');
  console.log(`  SUMMIT.MOON Quarterly USDC Distribution`);
  console.log(`  Quarter: ${QUARTER} (${start} → ${end})`);
  console.log(`  ${DRY_RUN ? '⚠️  DRY RUN — no transactions will be sent' : '🔴 LIVE MODE'}`);
  console.log('═══════════════════════════════════════════\n');

  await auditLog('payout_started', null, null, { quarter: QUARTER, dry_run: DRY_RUN });

  // Get all tokens with pools
  const tokens = await sb('GET', 'airdrop_totals?select=mint&limit=1000') || [];
  const uniqueMints = [...new Set(tokens.map(t => t.mint))];
  console.log(`  ${uniqueMints.length} tokens to process\n`);

  for (const mint of uniqueMints) {
    try {
      await distributeForToken(mint, start, end);
    } catch (e) {
      console.error(`  ❌ ${mint.slice(0, 12)}: ${e.message}`);
      await auditLog('payout_failed', mint, null, { error: e.message });
    }
  }

  console.log('\n  Distribution complete.');
}

async function distributeForToken(mint, startDate, endDate) {
  console.log(`  ── ${mint.slice(0, 12)}... ──`);

  // Check if batch already exists (resume support)
  let batch = await sb('GET', `airdrop_payout_batches?quarter=eq.${QUARTER}&mint=eq.${mint}&limit=1`);
  batch = batch && batch[0];

  if (batch && batch.status === 'completed') {
    console.log('    Already completed, skipping');
    return;
  }

  // Aggregate points for this quarter from snapshots
  const snapshots = await sb('GET',
    `v_quarterly_summary?mint=eq.${mint}&quarter=eq.${startDate}&select=wallet,quarter_points,days_snapshotted`
  );

  if (!snapshots || snapshots.length === 0) {
    console.log('    No snapshot data for this quarter, skipping');
    return;
  }

  // Filter out suspicious holders
  // (In production, call flag_suspicious_holders RPC and exclude flagged wallets)
  const holders = snapshots.filter(h => parseFloat(h.quarter_points) > 0);
  const totalPoints = holders.reduce((sum, h) => sum + parseFloat(h.quarter_points), 0);
  console.log(`    ${holders.length} eligible wallets, ${totalPoints.toFixed(2)} total points`);

  // Get USDC pool amount (from airdrop pool accumulation)
  // For now, read from batch if exists, or prompt
  let poolUsdc = batch ? parseFloat(batch.pool_usdc) : 0;

  if (!batch) {
    // TODO: In production, swap airdrop pool SOL → USDC via Jupiter here
    // For now, read pool_usdc from environment or batch record
    const poolSol = parseFloat(process.env.POOL_SOL || '0');
    if (poolSol <= 0) {
      console.log('    No POOL_SOL set, skipping. Set POOL_SOL env var with airdrop pool balance.');
      return;
    }

    // Create batch record
    await sb('POST', 'airdrop_payout_batches', {
      quarter: QUARTER,
      mint,
      pool_sol: poolSol,
      pool_usdc: poolSol * 180, // TODO: use actual swap rate
      sol_to_usdc_rate: 180,
      total_points: totalPoints,
      total_wallets: holders.length,
      status: 'distributing',
    });

    batch = (await sb('GET', `airdrop_payout_batches?quarter=eq.${QUARTER}&mint=eq.${mint}&limit=1`))[0];
    poolUsdc = parseFloat(batch.pool_usdc);
  }

  if (poolUsdc <= 0) {
    console.log('    Pool USDC is 0, skipping');
    return;
  }

  console.log(`    Pool: ${poolUsdc.toFixed(2)} USDC`);

  // Calculate individual payouts
  const payouts = holders.map(h => {
    const pts = parseFloat(h.quarter_points);
    const share = pts / totalPoints;
    const usdc = share * poolUsdc;
    return {
      quarter: QUARTER,
      mint,
      wallet: h.wallet,
      points: pts,
      share_pct: Math.round(share * 1e8) / 1e8,
      usdc_amount: Math.round(usdc * 1e6) / 1e6,
      batch_id: batch.id,
      status: usdc < MIN_PAYOUT_USDC ? 'skipped' : 'pending',
    };
  });

  // Insert payout records (idempotent via UNIQUE constraint)
  for (let i = 0; i < payouts.length; i += 500) {
    await sb('POST', 'airdrop_payouts', payouts.slice(i, i + 500));
  }
  console.log(`    ${payouts.length} payout records created`);

  // Get pending payouts
  const pending = await sb('GET',
    `airdrop_payouts?batch_id=eq.${batch.id}&status=eq.pending&order=usdc_amount.desc&limit=10000`
  ) || [];

  if (pending.length === 0) {
    console.log('    No pending payouts');
    await sb('PATCH', `airdrop_payout_batches?id=eq.${batch.id}`, { status: 'completed', completed_at: new Date().toISOString() });
    return;
  }

  console.log(`    Sending ${pending.length} payouts...`);

  // Send in batches
  const botUsdcAta = await getAssociatedTokenAddress(USDC_MINT, botKeypair.publicKey);
  let walletsPaid = batch.wallets_paid || 0;
  let usdcDistributed = parseFloat(batch.usdc_distributed) || 0;

  for (let i = 0; i < pending.length; i += TRANSFERS_PER_TX) {
    const chunk = pending.slice(i, i + TRANSFERS_PER_TX);

    if (DRY_RUN) {
      for (const p of chunk) {
        console.log(`    [DRY] ${p.wallet.slice(0, 8)}... → ${p.usdc_amount} USDC`);
      }
      continue;
    }

    try {
      const tx = new Transaction();

      for (const p of chunk) {
        const destWallet = new PublicKey(p.wallet);
        const destAta = await getAssociatedTokenAddress(USDC_MINT, destWallet);

        // Check if ATA exists
        const ataInfo = await connection.getAccountInfo(destAta);
        if (!ataInfo) {
          tx.add(createAssociatedTokenAccountInstruction(
            botKeypair.publicKey, destAta, destWallet, USDC_MINT
          ));
        }

        // USDC has 6 decimals
        const amount = Math.floor(p.usdc_amount * 1e6);
        if (amount > 0) {
          tx.add(createTransferInstruction(botUsdcAta, destAta, botKeypair.publicKey, amount));
        }
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = botKeypair.publicKey;
      tx.sign(botKeypair);

      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      // Update payout records
      for (const p of chunk) {
        await sb('PATCH', `airdrop_payouts?id=eq.${p.id}`, {
          status: 'confirmed',
          tx_sig: sig,
          confirmed_at: new Date().toISOString(),
        });
        walletsPaid++;
        usdcDistributed += p.usdc_amount;
      }

      // Update batch progress
      await sb('PATCH', `airdrop_payout_batches?id=eq.${batch.id}`, {
        wallets_paid: walletsPaid,
        usdc_distributed: Math.round(usdcDistributed * 1e6) / 1e6,
      });

      console.log(`    Batch ${Math.floor(i / TRANSFERS_PER_TX) + 1}: ${chunk.length} payouts sent (tx: ${sig.slice(0, 12)}...)`);
      await auditLog('payout_sent', mint, null, { tx_sig: sig, count: chunk.length, usdc: chunk.reduce((s, p) => s + p.usdc_amount, 0) });

    } catch (e) {
      console.error(`    Batch failed: ${e.message}`);
      // Mark chunk as failed
      for (const p of chunk) {
        await sb('PATCH', `airdrop_payouts?id=eq.${p.id}`, {
          status: 'failed',
          error_msg: e.message.slice(0, 500),
          retry_count: (p.retry_count || 0) + 1,
        });
      }
      await auditLog('payout_failed', mint, null, { error: e.message, batch_index: i });
    }

    // Rate limit between batches
    await new Promise(r => setTimeout(r, 500));
  }

  // Finalize batch
  const finalStatus = DRY_RUN ? 'pending' : 'completed';
  await sb('PATCH', `airdrop_payout_batches?id=eq.${batch.id}`, {
    status: finalStatus,
    wallets_paid: walletsPaid,
    usdc_distributed: Math.round(usdcDistributed * 1e6) / 1e6,
    completed_at: new Date().toISOString(),
  });

  console.log(`    Done. ${walletsPaid} wallets paid, ${usdcDistributed.toFixed(2)} USDC distributed`);
}

distribute().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
