use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{LiquidityPool, LiquidityPoolAccount, LiquidityProvider};

pub fn remove_liquidity(
    _ctx: Context<RemoveLiquidity>,
    _nonce: u8,
    _init_pc_amount: u64,
) -> Result<()> {
    // Remove liquidity is not used in the bonding curve model.
    // After graduation, liquidity is managed by Raydium.
    msg!("Remove liquidity not supported on bonding curve");
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK
    #[account(
        mut,
        seeds = [b"global"],
        bump,
    )]
    pub global_account: AccountInfo<'info>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}