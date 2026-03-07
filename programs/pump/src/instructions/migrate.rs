use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};
use raydium_contract_instructions::amm_instruction;
use solana_program::program::invoke_signed;

use crate::{
    errors::CustomError,
    state::{CurveConfiguration, LiquidityPool},
};

/// Migrate a graduated bonding curve to a Raydium AMM pool.
/// Can only be called after the pool's `graduated` flag is set to true.
/// This creates a Raydium pool, seeds it with the remaining tokens + SOL,
/// and effectively transitions trading from the bonding curve to Raydium.
pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, nonce: u8) -> Result<()> {
    let pool = &ctx.accounts.pool;

    // Must be graduated
    require!(pool.graduated, CustomError::NotGraduated);

    msg!(
        "Migrating pool for mint {:?} to Raydium. SOL reserve: {:?}, Token reserve: {:?}",
        pool.token_one,
        pool.reserve_two,
        pool.reserve_one
    );

    let init_coin_amount = ctx.accounts.pool_token_account.amount;
    let init_pc_amount = pool.reserve_two;

    // Build the Raydium initialize2 instruction
    let ix = amm_instruction::initialize(
        &ctx.accounts.raydium_amm_program.key(),
        &ctx.accounts.amm.key(),
        &ctx.accounts.amm_authority.key(),
        &ctx.accounts.amm_open_orders.key(),
        &ctx.accounts.amm_lp_mint.key(),
        &ctx.accounts.coin_mint.key(),
        &ctx.accounts.pc_mint.key(),
        &ctx.accounts.amm_coin_vault.key(),
        &ctx.accounts.amm_pc_vault.key(),
        &ctx.accounts.amm_target_orders.key(),
        &ctx.accounts.amm_config.key(),
        &ctx.accounts.create_fee_destination.key(),
        &ctx.accounts.market_program.key(),
        &ctx.accounts.market.key(),
        &ctx.accounts.user_wallet.key(),
        &ctx.accounts.user_token_coin.key(),
        &ctx.accounts.user_token_pc.key(),
        &ctx.accounts.user_token_lp.key(),
        nonce,
        0, // open_time = 0, start immediately
        init_pc_amount,
        init_coin_amount,
    )?;

    // Sign with the global PDA
    let bump = ctx.bumps.global_account;
    let seeds: &[&[u8]] = &[b"global", &[bump]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.raydium_amm_program.to_account_info(),
            ctx.accounts.amm.to_account_info(),
            ctx.accounts.amm_authority.to_account_info(),
            ctx.accounts.amm_open_orders.to_account_info(),
            ctx.accounts.amm_lp_mint.to_account_info(),
            ctx.accounts.coin_mint.to_account_info(),
            ctx.accounts.pc_mint.to_account_info(),
            ctx.accounts.amm_coin_vault.to_account_info(),
            ctx.accounts.amm_pc_vault.to_account_info(),
            ctx.accounts.amm_target_orders.to_account_info(),
            ctx.accounts.amm_config.to_account_info(),
            ctx.accounts.create_fee_destination.to_account_info(),
            ctx.accounts.market_program.to_account_info(),
            ctx.accounts.market.to_account_info(),
            ctx.accounts.user_wallet.to_account_info(),
            ctx.accounts.user_token_coin.to_account_info(),
            ctx.accounts.user_token_pc.to_account_info(),
            ctx.accounts.user_token_lp.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
        &[seeds],
    )?;

    msg!("Successfully migrated to Raydium AMM!");

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

    /// CHECK: Global PDA that holds pool funds
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

    /// Pool's token account (tokens to seed into Raydium)
    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = global_account,
    )]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    // === Raydium AMM accounts ===
    /// CHECK: Raydium AMM program
    pub raydium_amm_program: AccountInfo<'info>,

    /// CHECK: AMM account (will be initialized by Raydium)
    #[account(mut)]
    pub amm: AccountInfo<'info>,

    /// CHECK: AMM authority PDA
    pub amm_authority: AccountInfo<'info>,

    /// CHECK: AMM open orders
    #[account(mut)]
    pub amm_open_orders: AccountInfo<'info>,

    /// CHECK: AMM LP mint
    #[account(mut)]
    pub amm_lp_mint: AccountInfo<'info>,

    /// Token mint (coin side)
    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// CHECK: Wrapped SOL mint (pc side)
    #[account(mut)]
    pub pc_mint: AccountInfo<'info>,

    /// CHECK: AMM coin vault
    #[account(mut)]
    pub amm_coin_vault: AccountInfo<'info>,

    /// CHECK: AMM pc vault
    #[account(mut)]
    pub amm_pc_vault: AccountInfo<'info>,

    /// CHECK: AMM target orders
    #[account(mut)]
    pub amm_target_orders: AccountInfo<'info>,

    /// CHECK: AMM config
    pub amm_config: AccountInfo<'info>,

    /// CHECK: Raydium create fee destination
    #[account(mut)]
    pub create_fee_destination: AccountInfo<'info>,

    /// CHECK: OpenBook/Serum market program
    pub market_program: AccountInfo<'info>,

    /// CHECK: OpenBook/Serum market
    #[account(mut)]
    pub market: AccountInfo<'info>,

    /// CHECK: User wallet (signer, pays for creation)
    #[account(mut)]
    pub user_wallet: Signer<'info>,

    /// CHECK: User's coin token account
    #[account(mut)]
    pub user_token_coin: AccountInfo<'info>,

    /// CHECK: User's PC (WSOL) token account
    #[account(mut)]
    pub user_token_pc: AccountInfo<'info>,

    /// CHECK: User's LP token account
    #[account(mut)]
    pub user_token_lp: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}