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
//  - Permissionless: anyone can call (fees + escrow are constrained)
// ═══════════════════════════════════════════════════════════

pub fn prepare_migration(ctx: Context<PrepareMigration>) -> Result<()> {
    let pool = &ctx.accounts.pool;

    require!(pool.graduated, CustomError::NotGraduated);
    require!(pool.meteora_pool == Pubkey::default(), CustomError::AlreadyMigrated);

    let pool_sol = pool.reserve_two;
    let pool_tokens = pool.reserve_one;

    // ── Graduation fee math (all in lamports) ──
    let total_fee = pool_sol
        .checked_mul(GRAD_FEE_BPS).unwrap()
        .checked_div(10_000).unwrap();

    let protocol_fee = total_fee
        .checked_mul(GRAD_PROTOCOL_BPS).unwrap()
        .checked_div(10_000).unwrap();

    let airdrop_fee = total_fee
        .checked_mul(GRAD_AIRDROP_BPS).unwrap()
        .checked_div(10_000).unwrap();

    let holder_fee = total_fee
        .checked_mul(GRAD_HOLDER_BPS).unwrap()
        .checked_div(10_000).unwrap();

    let sol_to_escrow = pool_sol
        .checked_sub(protocol_fee).unwrap()
        .checked_sub(airdrop_fee).unwrap()
        .checked_sub(holder_fee).unwrap();

    let global_bump = ctx.bumps.global_account;

    // ── Transfer fees from global PDA to wallets ──

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
    #[account(mut, seeds = [b"global"], bump)]
    pub global_account: AccountInfo<'info>,

    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    /// CHECK: Migration escrow PDA — program-owned, holds funds during migration
    #[account(mut, seeds = [b"migration_escrow", coin_mint.key().as_ref()], bump)]
    pub escrow: AccountInfo<'info>,

    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = global_account)]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = coin_mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// CHECK: Protocol fee destination — constrained to config
    #[account(mut, constraint = protocol_wallet.key() == dex_configuration_account.protocol_wallet @ CustomError::Unauthorized)]
    pub protocol_wallet: AccountInfo<'info>,

    /// CHECK: Airdrop fee destination — constrained to config
    #[account(mut, constraint = airdrop_wallet.key() == dex_configuration_account.airdrop_wallet @ CustomError::Unauthorized)]
    pub airdrop_wallet: AccountInfo<'info>,

    /// CHECK: Holder reserve destination (protocol wallet for V1)
    #[account(mut)]
    pub holder_wallet: AccountInfo<'info>,

    /// Pays for escrow ATA creation
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════
//  release_escrow
//  - ONLY migration_authority can call
//  - Sends SOL + tokens to the migration_authority wallet
//  - Bot should bundle this + Meteora pool creation atomically
// ═══════════════════════════════════════════════════════════

pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
    let mint_key = ctx.accounts.coin_mint.key();
    let escrow_bump = ctx.bumps.escrow;

    let escrow_sol = ctx.accounts.escrow.lamports();
    let escrow_tokens = ctx.accounts.escrow_token_account.amount;

    require!(escrow_sol > 0 || escrow_tokens > 0, CustomError::EscrowNotFunded);

    // Transfer SOL from escrow to migration authority
    let min_rent = Rent::get()?.minimum_balance(0);
    let sol_to_send = escrow_sol.saturating_sub(min_rent);

    if sol_to_send > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.bot.to_account_info(),
                },
                &[&[b"migration_escrow", mint_key.as_ref(), &[escrow_bump]]],
            ),
            sol_to_send,
        )?;
    }

    // Transfer tokens from escrow ATA to bot ATA
    if escrow_tokens > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.bot_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[&[b"migration_escrow", mint_key.as_ref(), &[escrow_bump]]],
            ),
            escrow_tokens,
        )?;
    }

    msg!(
        "release_escrow: sol={} tokens={} → migration_authority={}",
        sol_to_send, escrow_tokens, ctx.accounts.bot.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
        constraint = pool.graduated @ CustomError::NotGraduated,
        constraint = pool.meteora_pool == Pubkey::default() @ CustomError::AlreadyMigrated,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    /// CHECK: Migration escrow PDA
    #[account(mut, seeds = [b"migration_escrow", coin_mint.key().as_ref()], bump)]
    pub escrow: AccountInfo<'info>,

    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = escrow)]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// Bot's token account — MUST be owned by migration_authority
    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = bot)]
    pub bot_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// CRITICAL: Only the migration_authority stored in config can call this
    #[account(
        mut,
        constraint = bot.key() == dex_configuration_account.migration_authority @ CustomError::Unauthorized,
    )]
    pub bot: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════
//  cancel_escrow
//  - Admin-only recovery if migration fails
//  - Returns SOL + tokens to global PDA / pool ATA
//  - Does NOT reopen bonding curve (graduated stays true)
// ═══════════════════════════════════════════════════════════

pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
    let mint_key = ctx.accounts.coin_mint.key();
    let escrow_bump = ctx.bumps.escrow;

    let escrow_sol = ctx.accounts.escrow.lamports();
    let escrow_tokens = ctx.accounts.escrow_token_account.amount;

    let min_rent = Rent::get()?.minimum_balance(0);
    let sol_to_return = escrow_sol.saturating_sub(min_rent);

    if sol_to_return > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.global_account.to_account_info(),
                },
                &[&[b"migration_escrow", ctx.accounts.coin_mint.key().as_ref(), &[ctx.bumps.escrow]]],
            ),
            sol_to_return,
        )?;
    }

    if escrow_tokens > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[&[b"migration_escrow", mint_key.as_ref(), &[escrow_bump]]],
            ),
            escrow_tokens,
        )?;
    }

    msg!(
        "cancel_escrow: returned sol={} tokens={} to pool",
        sol_to_return, escrow_tokens
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
        constraint = pool.graduated @ CustomError::NotGraduated,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK: Global PDA — receives SOL back
    #[account(mut, seeds = [b"global"], bump)]
    pub global_account: AccountInfo<'info>,

    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    /// CHECK: Migration escrow PDA
    #[account(mut, seeds = [b"migration_escrow", coin_mint.key().as_ref()], bump)]
    pub escrow: AccountInfo<'info>,

    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = escrow)]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = global_account)]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// Admin only — must be protocol wallet
    #[account(
        mut,
        constraint = admin.key() == dex_configuration_account.protocol_wallet @ CustomError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════
//  Legacy stub — kept for IDL compatibility
// ═══════════════════════════════════════════════════════════

pub fn migrate_to_raydium(_ctx: Context<MigrateToRaydium>, _nonce: u8) -> Result<()> {
    msg!("DEPRECATED: use prepare_migration + release_escrow");
    err!(CustomError::AlreadyGraduated)
}

#[derive(Accounts)]
pub struct MigrateToRaydium<'info> {
    #[account(
        mut,
        seeds = [LiquidityPool::POOL_SEED_PREFIX.as_bytes(), coin_mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    /// CHECK: Global PDA
    #[account(mut, seeds = [b"global"], bump)]
    pub global_account: AccountInfo<'info>,

    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = global_account)]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub user_wallet: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
