use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

use crate::{
    consts::{GRAD_FEE_BPS, GRAD_PROTOCOL_BPS, GRAD_AIRDROP_BPS, GRAD_HOLDER_BPS},
    errors::CustomError,
    state::{CurveConfiguration, LiquidityPool},
};

// ═══════════════════════════════════════════════════════════
//  prepare_migration
//  - Extracts graduation fees to protocol/airdrop/holder wallets
//  - Moves remaining SOL + tokens to escrow PDA
//  - Funds NEVER leave program custody
// ═══════════════════════════════════════════════════════════

pub fn prepare_migration(ctx: Context<PrepareMigration>) -> Result<()> {
    let pool = &ctx.accounts.pool;

    // Sanity checks
    require!(pool.graduated, CustomError::NotGraduated);
    require!(pool.meteora_pool == Pubkey::default(), CustomError::AlreadyMigrated);

    let pool_sol = pool.reserve_two;
    let pool_tokens = pool.reserve_one;

    // ── Graduation fee math (all in lamports) ──
    let total_fee = pool_sol
        .checked_mul(GRAD_FEE_BPS)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    let protocol_fee = total_fee
        .checked_mul(GRAD_PROTOCOL_BPS)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    let airdrop_fee = total_fee
        .checked_mul(GRAD_AIRDROP_BPS)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    let holder_fee = total_fee
        .checked_mul(GRAD_HOLDER_BPS)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    // Everything else goes to escrow for Meteora pool creation
    let sol_to_escrow = pool_sol
        .checked_sub(protocol_fee)
        .unwrap()
        .checked_sub(airdrop_fee)
        .unwrap()
        .checked_sub(holder_fee)
        .unwrap();

    let global_bump = ctx.bumps.global_account;

    // ── Transfer fees from global PDA to wallets ──

    // Protocol fee
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.global_account.to_account_info(),
                to: ctx.accounts.protocol_wallet.to_account_info(),
            },
            &[&[b"global", &[global_bump]]],
        ),
        protocol_fee,
    )?;

    // Airdrop fee
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.global_account.to_account_info(),
                to: ctx.accounts.airdrop_wallet.to_account_info(),
            },
            &[&[b"global", &[global_bump]]],
        ),
        airdrop_fee,
    )?;

    // Holder reserve fee
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.global_account.to_account_info(),
                to: ctx.accounts.holder_wallet.to_account_info(),
            },
            &[&[b"global", &[global_bump]]],
        ),
        holder_fee,
    )?;

    // ── Transfer remaining SOL to escrow PDA ──
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.global_account.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
            &[&[b"global", &[global_bump]]],
        ),
        sol_to_escrow,
    )?;

    // ── Transfer tokens from pool ATA to escrow ATA ──
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.global_account.to_account_info(),
            },
            &[&[b"global", &[global_bump]]],
        ),
        pool_tokens,
    )?;

    msg!(
        "prepare_migration: fee={} protocol={} airdrop={} holder={} escrow_sol={} escrow_tokens={}",
        total_fee, protocol_fee, airdrop_fee, holder_fee, sol_to_escrow, pool_tokens
    );

    Ok(())
}

#[derive(Accounts)]
pub struct PrepareMigration<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
        constraint = pool.graduated @ CustomError::NotGraduated,
        constraint = pool.meteora_pool == Pubkey::default() @ CustomError::AlreadyMigrated,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK: Global PDA — holds pool SOL
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

    /// CHECK: Migration escrow PDA — program-owned, holds funds during migration
    #[account(
        mut,
        seeds = [b"migration_escrow", coin_mint.key().as_ref()],
        bump,
    )]
    pub escrow: AccountInfo<'info>,

    /// Pool's token account (global PDA is authority)
    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = global_account,
    )]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    /// Escrow's token account
    #[account(
        init_if_needed,
        payer = bot,
        associated_token::mint = coin_mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// CHECK: Protocol fee destination
    #[account(
        mut,
        constraint = protocol_wallet.key() == dex_configuration_account.protocol_wallet @ CustomError::Unauthorized,
    )]
    pub protocol_wallet: AccountInfo<'info>,

    /// CHECK: Airdrop fee destination
    #[account(
        mut,
        constraint = airdrop_wallet.key() == dex_configuration_account.airdrop_wallet @ CustomError::Unauthorized,
    )]
    pub airdrop_wallet: AccountInfo<'info>,

    /// CHECK: Holder reserve destination (protocol wallet for V1)
    #[account(mut)]
    pub holder_wallet: AccountInfo<'info>,

    /// Bot pays for escrow ATA creation, but never holds migration funds
    #[account(mut)]
    pub bot: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════
//  release_escrow
//  - Bot calls this to withdraw SOL + tokens from escrow
//  - Bot uses these to create Meteora pool (off-chain SDK)
//  - This is the ONLY point where funds leave program custody
// ═══════════════════════════════════════════════════════════

pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let mint_key = ctx.a
