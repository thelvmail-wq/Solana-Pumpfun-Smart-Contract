use anchor_lang::prelude::*;

pub mod consts;
pub mod errors;
pub mod instructions;
pub mod registry;
pub mod state;
pub mod utils;

use crate::instructions::*;

declare_id!("7wUQXRQtBzTmyp9kcrmok9FKcc4RSYXxPYN9FGDLnqxb");

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

    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
        instructions::migrate_to_raydium(ctx, nonce)
    }

    /// Register a new token's metadata for anti-vamp protection.
    /// Called at deploy time. If a protected token already holds the same
    /// ticker/image/identity hash, Anchor's init will fail → deploy blocked.
    pub fn register_token(
        ctx: Context<RegisterToken>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
        ticker_raw: [u8; 16],
    ) -> Result<()> {
        instructions::register_token(ctx, ticker_hash, image_hash, identity_hash, ticker_raw)
    }

    /// Keeper-only: activate protection when token MC > $100K.
    /// Locks ticker, image, and identity — no new token can reuse them.
    pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
        instructions::activate_protection(ctx)
    }

    /// Keeper-only: deactivate protection when token MC drops below $100K.
    /// Unlocks ticker, image, and identity for reuse.
    pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
        instructions::deactivate_protection(ctx)
    }
}