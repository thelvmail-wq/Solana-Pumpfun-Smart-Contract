use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{
    consts::{GRAD_FEE_TOTAL_BPS, GRAD_PROTOCOL_BPS, GRAD_AIRDROP_BPS, GRAD_HOLDER_RESERVE_BPS},
    errors::CustomError,
    state::{CurveConfiguration, LiquidityPool},
};

// ============================================================
// STEP 1: prepare_migration
// Called by anyone (permissionless) after pool graduates.
// Extracts SOL from the global PDA, distributes graduation fees,
// and transfers remaining SOL + tokens to a migration authority
// wallet that the bot controls. The bot then uses the Meteora
// TypeScript SDK to create the pool (no CPI needed).
// ============================================================

pub fn prepare_migration(ctx: Context<PrepareMigration>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Guard: must be graduated but not yet migrated
    require!(pool.graduated, CustomError::NotGraduated);
    require!(pool.meteora_pool == Pubkey::default(), CustomError::AlreadyMigrated);

    let sol_balance = ctx.accounts.global_account.lamports();
    // Keep rent-exempt minimum in global PDA so it doesn't get garbage collected
    let rent = Rent::get()?;
    let rent_exempt_min = rent.minimum_balance(0);
    let available_sol = sol_balance.saturating_sub(rent_exempt_min);

    msg!("Preparing migration. Available SOL: {}", available_sol);

    // Calculate graduation fee: 2.5% of available SOL
    let total_grad_fee = available_sol
        .checked_mul(GRAD_FEE_TOTAL_BPS)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?
        .checked_div(10_000)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

    // Fee splits (percentages of the 2.5% fee)
    let protocol_fee = total_grad_fee
        .checked_mul(GRAD_PROTOCOL_BPS)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?
        .checked_div(10_000)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

    let airdrop_fee = total_grad_fee
        .checked_mul(GRAD_AIRDROP_BPS)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?
        .checked_div(10_000)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

    let holder_reserve_fee = total_grad_fee
        .checked_mul(GRAD_HOLDER_RESERVE_BPS)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?
        .checked_div(10_000)
        .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

    // Remaining SOL goes to the migration authority (bot wallet)
    // which will use it to seed the Meteora pool
    let sol_for_meteora = available_sol
        .saturating_sub(protocol_fee)
        .saturating_sub(airdrop_fee)
        .saturating_sub(holder_reserve_fee);

    let bump = ctx.bumps.global_account;
    let signer_seeds: &[&[&[u8]]] = &[&[b"global", &[bump]]];

    // Transfer protocol fee
    if protocol_fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.global_account.to_account_info(),
                    to: ctx.accounts.protocol_wallet.to_account_info(),
                },
                signer_seeds,
            ),
            protocol_fee,
        )?;
        msg!("Protocol fee: {} lamports", protocol_fee);
    }

    // Transfer airdrop fee
    if airdrop_fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.global_account.to_account_info(),
                    to: ctx.accounts.airdrop_wallet.to_account_info(),
                },
                signer_seeds,
            ),
            airdrop_fee,
        )?;
        msg!("Airdrop fee: {} lamports", airdrop_fee);
    }

    // Transfer holder reserve fee
    if holder_reserve_fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.global_account.to_account_info(),
                    to: ctx.accounts.holder_reserve_wallet.to_account_info(),
                },
                signer_seeds,
            ),
            holder_reserve_fee,
        )?;
        msg!("Holder reserve fee: {} lamports", holder_reserve_fee);
    }

    // Transfer remaining SOL to migration authority (bot wallet)
    if sol_for_meteora > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.global_account.to_account_info(),
                    to: ctx.accounts.migration_authority.to_account_info(),
                },
                signer_seeds,
            ),
            sol_for_meteora,
        )?;
        msg!("SOL for Meteora pool: {} lamports", sol_for_meteora);
    }

    // Transfer ALL remaining tokens from pool to migration authority's token account
    let token_balance = ctx.accounts.pool_token_account.amount;
    if token_balance > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.migration_token_account.to_account_info(),
                    authority: ctx.accounts.global_account.to_account_info(),
                },
                signer_seeds,
            ),
            token_balance,
        )?;
        msg!("Tokens transferred to migration authority: {}", token_balance);
    }

    msg!(
        "MIGRATION_READY mint={} sol={} tokens={} protocol_fee={} airdrop_fee={} holder_fee={}",
        pool.token_one,
        sol_for_meteora,
        token_balance,
        protocol_fee,
        airdrop_fee,
        holder_reserve_fee,
    );

    Ok(())
}

// ============================================================
// STEP 2: confirm_migration
// Called by the migration bot after it has created the Meteora
// pool and permanently locked the LP. Stores the Meteora pool
// address on-chain so the frontend can redirect.
// Only callable by protocol_wallet (admin).
// ============================================================

pub fn confirm_migration(ctx: Context<ConfirmMigration>, meteora_pool: Pubkey) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(pool.graduated, CustomError::NotGraduated);
    require!(pool.meteora_pool == Pubkey::default(), CustomError::AlreadyMigrated);

    pool.meteora_pool = meteora_pool;
    pool.migration_complete = true;

    msg!(
        "MIGRATION_COMPLETE mint={} meteora_pool={}",
        pool.token_one,
        meteora_pool,
    );

    Ok(())
}

// ============================================================
// STEP 1 ACCOUNTS: PrepareMigration
// ============================================================

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

    /// CHECK: Global PDA that holds SOL and is authority for pool token accounts
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

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// Pool's token account (holds remaining bonding curve tokens)
    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = global_account,
    )]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    /// Protocol wallet receives graduation fee
    /// CHECK: validated against config
    #[account(
        mut,
        constraint = protocol_wallet.key() == dex_configuration_account.protocol_wallet @ CustomError::Unauthorized,
    )]
    pub protocol_wallet: AccountInfo<'info>,

    /// Airdrop wallet receives graduation fee portion
    /// CHECK: validated against config
    #[account(
        mut,
        constraint = airdrop_wallet.key() == dex_configuration_account.airdrop_wallet @ CustomError::Unauthorized,
    )]
    pub airdrop_wallet: AccountInfo<'info>,

    /// CHECK: Top holder reserve wallet. For now, same as protocol_wallet.
    /// Can be changed to a dedicated address later.
    #[account(mut)]
    pub holder_reserve_wallet: AccountInfo<'info>,

    /// Migration authority: the bot wallet that will create the Meteora pool.
    /// Receives the SOL + tokens to seed into Meteora.
    #[account(mut)]
    pub migration_authority: Signer<'info>,

    /// Migration authority's token account for the memecoin
    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = migration_authority,
    )]
    pub migration_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// STEP 2 ACCOUNTS: ConfirmMigration
// ============================================================

#[derive(Accounts)]
pub struct ConfirmMigration<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
        constraint = pool.graduated @ CustomError::NotGraduated,
        constraint = pool.meteora_pool == Pubkey::default() @ CustomError::AlreadyMigrated,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    pub coin_mint: Box<Account<'info, Mint>>,

    #[account(
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    /// Only protocol wallet (admin) can confirm migration
    #[account(
        mut,
        constraint = admin.key() == dex_configuration_account.protocol_wallet @ CustomError::Unauthorized,
    )]
    pub admin: Signer<'info>,
}

// ============================================================
// KEEP OLD migrate_to_raydium FOR BACKWARD COMPAT (deprecated)
// This ensures existing IDL references don't break.
// ============================================================

pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, _nonce: u8) -> Result<()> {
    let pool = &ctx.accounts.pool;
    require!(pool.graduated, CustomError::NotGraduated);

    msg!(
        "DEPRECATED: Use prepare_migration + confirm_migration instead. Mint: {:?}",
        pool.token_one,
    );

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
