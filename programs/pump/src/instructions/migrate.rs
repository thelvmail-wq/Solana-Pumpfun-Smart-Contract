use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    errors::CustomError,
    state::{CurveConfiguration, LiquidityPool},
};

/// Migrate a graduated bonding curve to a Raydium AMM pool.
/// Can only be called after the pool's `graduated` flag is set to true.
/// Full Raydium CPI will be wired in production deployment.
pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, _nonce: u8) -> Result<()> {
    let pool = &ctx.accounts.pool;
    require!(pool.graduated, CustomError::NotGraduated);

    msg!(
        "Migration ready for mint {:?}. SOL: {:?}, Tokens: {:?}",
        pool.token_one,
        pool.reserve_two,
        pool.reserve_one
    );

    // TODO: Wire Raydium AMM CPI for production.
    // Requires: OpenBook market creation, then amm::initialize call
    // with pool's SOL + token reserves.

    Ok(())
}

#[derive(Accounts)]
pub struct MigrateToRaydium<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
        constraint = pool.graduated @ CustomError::NotGraduated,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK: Global PDA
    #[account(
        mut,
        seeds = [b"global"],
        bump,
    )]
    pub global_account: AccountInfo<'info>,

    #[account(
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = global_account,
    )]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub user_wallet: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}