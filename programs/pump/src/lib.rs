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

    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
        instructions::migrate_to_raydium(ctx, nonce)
    }

    /// Step 1 of 2: create the TokenRegistry PDA for a new token.
    pub fn create_token_registry(
        ctx: Context<CreateTokenRegistry>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
        ticker_raw: [u8; 16],
    ) -> Result<()> {
        instructions::create_token_registry(ctx, ticker_hash, image_hash, identity_hash, ticker_raw)
    }

    /// Step 2 of 2: claim ticker/image/identity locks.
    /// FIRST-DEPLOYER-WINS: if any lock PDA already exists, this tx fails.
    pub fn claim_locks(
        ctx: Context<ClaimLocks>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
    ) -> Result<()> {
        instructions::claim_locks(ctx, ticker_hash, image_hash, identity_hash)
    }

    /// Keeper-only: activate protection when token MC > $100K.
    pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
        instructions::activate_protection(ctx)
    }

    /// Keeper-only: deactivate protection when token MC drops below $100K.
    pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
        instructions::deactivate_protection(ctx)
    }
}