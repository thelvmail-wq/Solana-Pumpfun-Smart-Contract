use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    consts::{DEPLOY_FEE_LAMPORTS, DEPLOY_LP_PCT, DEPLOY_PROTOCOL_PCT, DEPLOY_AIRDROP_PCT},
    state::{LiquidityPool, LiquidityPoolAccount, LiquidityProvider, transfer_sol_to_pool},
};

pub fn add_liquidity(ctx: Context<AddLiquidity>, amount_one: u64, amount_two: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    let token_one_accounts = (
        &mut *ctx.accounts.mint_token_one.clone(),
        &mut *ctx.accounts.pool_token_account_one,
        &mut *ctx.accounts.user_token_account_one,
    );

    let token_two_accounts = (
        &mut *ctx.accounts.mint_token_one.clone(),
        &mut ctx.accounts.global_account.to_account_info(),
        &mut ctx.accounts.user.to_account_info().clone(),
    );

    pool.set_inner(LiquidityPool::new(
        ctx.accounts.mint_token_one.key(),
        ctx.bumps.pool,
        ctx.accounts.user.key(),
    ));

    let lp_portion = DEPLOY_FEE_LAMPORTS * DEPLOY_LP_PCT / 100;
    let _protocol_portion = DEPLOY_FEE_LAMPORTS * DEPLOY_PROTOCOL_PCT / 100;
    let airdrop_portion = DEPLOY_FEE_LAMPORTS * DEPLOY_AIRDROP_PCT / 100;

    transfer_sol_to_pool(
        ctx.accounts.user.to_account_info(),
        ctx.accounts.global_account.to_account_info(),
        DEPLOY_FEE_LAMPORTS,
        ctx.accounts.system_program.to_account_info(),
    )?;

    pool.airdrop_pool = airdrop_portion;

    pool.add_liquidity(
        token_one_accounts,
        token_two_accounts,
        amount_one,
        amount_two + lp_portion,
        &mut *ctx.accounts.liquidity_provider_account,
        &ctx.accounts.user,
        &ctx.accounts.token_program,
    )?;

    msg!("Pool created for mint: {:?}", ctx.accounts.mint_token_one.key());
    Ok(())
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        init,
        space = LiquidityPool::ACCOUNT_SIZE,
        payer = user,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), mint_token_one.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK
    #[account(
        mut,
        seeds = [b"global"],
        bump,
    )]
    pub global_account: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = LiquidityProvider::ACCOUNT_SIZE,
        seeds = [LiquidityProvider::SEED_PREFIX.as_bytes(), pool.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub liquidity_provider_account: Box<Account<'info, LiquidityProvider>>,

    #[account(mut)]
    pub mint_token_one: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = user,
        associated_token::mint = mint_token_one,
        associated_token::authority = global_account
    )]
    pub pool_token_account_one: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_token_one,
        associated_token::authority = user,
    )]
    pub user_token_account_one: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}