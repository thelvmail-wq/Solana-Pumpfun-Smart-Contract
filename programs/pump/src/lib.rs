use anchor_lang::prelude::*;

pub mod consts;
pub mod errors;
pub mod instructions;
pub mod registry;
pub mod state;
pub mod utils;

use crate::instructions::*;

declare_id!("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");

#[program]
pub mod pump {
    use super::*;

    pub fn initialize(
        ctx: Context<InitializeCurveConfiguration>,
        fee: f64,
        protocol_wallet: Pubkey,
        airdrop_wallet: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, fee, protocol_wallet, airdrop_wallet)
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_one: u64,
        amount_two: u64,
    ) -> Result<()> {
        instructions::add_liquidity(ctx, amount_one, amount_two)
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        nonce: u8,
        init_pc_amount: u64,
    ) -> Result<()> {
        instructions::remove_liquidity(ctx, nonce, init_pc_amount)
    }

    pub fn swap(ctx: Context<Swap>, amount: u64, style: u64) -> Result<()> {
        instructions::swap(ctx, amount, style)
    }

    /// DEPRECATED — kept for IDL compatibility
    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
        instructions::migrate_to_raydium(ctx, nonce)
    }

    // ── Migration (escrow PDA) ──────────────────────────

    /// Extract graduation fees, move remaining SOL + tokens to escrow PDA
    pub fn prepare_migration(ctx: Context<PrepareMigration>) -> Result<()> {
        instructions::prepare_migration(ctx)
    }

    /// Bot calls this to release escrow funds for Meteora pool creation
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow(ctx)
    }

    /// Admin-only: cancel failed migration, return funds to pool
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::cancel_escrow(ctx)
    }

    // ── Anti-vamp ───────────────────────────────────────

    pub fn register_token(
        ctx: Context<RegisterToken>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
        ticker_raw: [u8; 16],
    ) -> Result<()> {
        instructions::register_token(ctx, ticker_hash, image_hash, identity_hash, ticker_raw)
    }

    pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
        instructions::activate_protection(ctx)
    }

    pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
        instructions::deactivate_protection(ctx)
    }
}
