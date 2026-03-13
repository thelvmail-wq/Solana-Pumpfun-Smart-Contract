use anchor_lang::prelude::*;

pub mod consts;
pub mod errors;
pub mod instructions;
pub mod registry;
pub mod state;
pub mod utils;

use crate::instructions::*;

declare_id!("73wyBdTRbZPegtYQbjs4uCAvkiUK9wWKd91WWJHyYL3j");

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

    pub fn swap(ctx: Context<Swap>, amount: u64, style: u64, min_amount_out: u64) -> Result<()> {
        instructions::swap(ctx, amount, style, min_amount_out)
    }

    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
        instructions::migrate_to_raydium(ctx, nonce)
    }

    pub fn create_token_registry(
        ctx: Context<CreateTokenRegistry>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
        ticker_raw: [u8; 16],
    ) -> Result<()> {
        instructions::create_token_registry(ctx, ticker_hash, image_hash, identity_hash, ticker_raw)
    }

    pub fn claim_locks(
        ctx: Context<ClaimLocks>,
        ticker_hash: [u8; 32],
        image_hash: [u8; 32],
        identity_hash: [u8; 32],
    ) -> Result<()> {
        instructions::claim_locks(ctx, ticker_hash, image_hash, identity_hash)
    }

    pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
        instructions::activate_protection(ctx)
    }

    pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
        instructions::deactivate_protection(ctx)
    }

    pub fn create_source_lock(
        ctx: Context<CreateSourceLock>,
        source_hash: [u8; 32],
        image_phash: [u8; 8],
        expiry_timestamp: i64,
        ed25519_sig: [u8; 64],
        ed25519_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::create_source_lock(ctx, source_hash, image_phash, expiry_timestamp, ed25519_sig, ed25519_pubkey)
    }
}