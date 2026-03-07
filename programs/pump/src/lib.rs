use anchor_lang::prelude::*;

pub mod consts;
pub mod errors;
pub mod instructions;
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
}