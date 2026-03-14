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
 *   RPC_URL              — Solana
