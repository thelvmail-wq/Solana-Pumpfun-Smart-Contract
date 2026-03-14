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
        migration_authority: Pubkey,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, fee, protocol_wallet, airdrop_wallet, migration_authority)
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_one: u64,
        amount_two: u64,
    ) -> Result<()> {
        instructions::add_liquidity::add_liquidity(ctx, amount_one, amount_two)
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        nonce: u8,
        init_pc_amount: u64,
    ) -> Result<()> {
        instructions::remove_liquidity::remove_liquidity(ctx, nonce, init_pc_amount)
    }

    pub fn swap(ctx: Context<Swap>, amount: u64, style: u64) -> Result<()> {
        instructions::swap::swap(ctx, amount, style)
    }

    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
        instructions::migrate::migrate_to_raydium(ctx, nonce)
    }

    pub fn prepare_migration(ctx: Context<PrepareMigration>) -> Result<()> {
        instructions::migrate::prepare_migration(ctx)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::migrate::release_escrow(ctx)
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::migrate::cancel_escrow(ctx)
    }

    pub fn create_token_registry(
        ctx: Context<CreateTokenRegistry>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
        ticker_raw: [u8; 16],
    ) -> Result<()> {
        instructions::register_token::create_token_registry(ctx, ticker_hash, image_hash, identity_hash, ticker_raw)
    }

    pub fn claim_locks(
        ctx: Context<ClaimLocks>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
    ) -> Result<()> {
        instructions::register_token::claim_locks(ctx, ticker_hash, image_hash, identity_hash)
    }

    pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
        instructions::register_token::activate_protection(ctx)
    }

    pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
        instructions::register_token::deactivate_protection(ctx)
    }
}
