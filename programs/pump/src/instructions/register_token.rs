use anchor_lang::prelude::*;

use crate::{
    errors::CustomError,
    registry::{IdentityLock, ImageLock, TickerLock, TokenRegistry},
    state::CurveConfiguration,
};

// ─── INSTRUCTION 1: create_token_registry ────────────────────────────────────
// Creates the TokenRegistry PDA for this mint.
// Call this first, then call claim_locks.

pub fn create_token_registry(
    ctx: Context<CreateTokenRegistry>,
    ticker_hash: [u8; 32],
    image_hash: [u8; 32],
    identity_hash: [u8; 32],
    ticker_raw: [u8; 16],
) -> Result<()> {
    let clock = Clock::get()?;
    let registry = &mut ctx.accounts.token_registry;
    registry.mint          = ctx.accounts.mint.key();
    registry.ticker_hash   = ticker_hash;
    registry.image_hash    = image_hash;
    registry.identity_hash = identity_hash;
    registry.ticker_raw    = ticker_raw;
    registry.protected     = false;
    registry.protected_at  = 0;
    registry.creator       = ctx.accounts.creator.key();
    registry.created_at    = clock.unix_timestamp;
    registry.bump          = ctx.bumps.token_registry;
    msg!("Registry created: mint={:?}", ctx.accounts.mint.key());
    Ok(())
}

// ─── INSTRUCTION 2: claim_locks ───────────────────────────────────────────────
// Creates the three lock PDAs seeded by ticker/image/identity hash.
// FIRST-DEPLOYER-WINS: if any PDA already exists, `init` fails with
// AccountAlreadyInUse before any code runs — Solana runtime enforces it.
// Split from create_token_registry to keep each struct's stack frame under 4096B.

pub fn claim_locks(
    ctx: Context<ClaimLocks>,
    ticker_hash: [u8; 32],
    image_hash: [u8; 32],
    identity_hash: [u8; 32],
) -> Result<()> {
    let registry_key = ctx.accounts.token_registry.key();

    {
        let mut data = ctx.accounts.ticker_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&ticker_hash);
        data[72] = 0u8;
        data[73] = ctx.bumps.ticker_lock;
    }
    {
        let mut data = ctx.accounts.image_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&image_hash);
        data[72] = 0u8;
        data[73] = ctx.bumps.image_lock;
    }
    {
        let mut data = ctx.accounts.identity_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&identity_hash);
        data[72] = 0u8;
        data[73..81].copy_from_slice(&0i64.to_le_bytes());
        data[81] = ctx.bumps.identity_lock;
    }

    msg!("Locks claimed for registry={:?}", registry_key);
    Ok(())
}

// ─── KEPT FOR BACKWARDS COMPAT: register_token calls both internally ──────────
// This is the single-instruction path. If it still stack-overflows on some
// platforms, call create_token_registry + claim_locks separately instead.

pub fn register_token(
    ctx: Context<RegisterToken>,
    ticker_hash: [u8; 32],
    image_hash: [u8; 32],
    identity_hash: [u8; 32],
    ticker_raw: [u8; 16],
) -> Result<()> {
    let clock = Clock::get()?;
    let registry = &mut ctx.accounts.token_registry;
    registry.mint          = ctx.accounts.mint.key();
    registry.ticker_hash   = ticker_hash;
    registry.image_hash    = image_hash;
    registry.identity_hash = identity_hash;
    registry.ticker_raw    = ticker_raw;
    registry.protected     = false;
    registry.protected_at  = 0;
    registry.creator       = ctx.accounts.creator.key();
    registry.created_at    = clock.unix_timestamp;
    registry.bump          = ctx.bumps.token_registry;

    let registry_key = registry.key();
    {
        let mut data = ctx.accounts.ticker_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&ticker_hash);
        data[72] = 0u8;
        data[73] = ctx.bumps.ticker_lock;
    }
    {
        let mut data = ctx.accounts.image_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&image_hash);
        data[72] = 0u8;
        data[73] = ctx.bumps.image_lock;
    }
    {
        let mut data = ctx.accounts.identity_lock.try_borrow_mut_data()?;
        data[8..40].copy_from_slice(registry_key.as_ref());
        data[40..72].copy_from_slice(&identity_hash);
        data[72] = 0u8;
        data[73..81].copy_from_slice(&0i64.to_le_bytes());
        data[81] = ctx.bumps.identity_lock;
    }

    msg!("Token registered: mint={:?}", ctx.accounts.mint.key());
    Ok(())
}

// ─── keeper instructions ──────────────────────────────────────────────────────

pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
    let config = &ctx.accounts.dex_configuration_account;
    require!(
        ctx.accounts.authority.key() == config.protocol_wallet,
        CustomError::Unauthorized
    );
    let clock = Clock::get()?;
    ctx.accounts.token_registry.protected    = true;
    ctx.accounts.token_registry.protected_at = clock.unix_timestamp;
    ctx.accounts.ticker_lock.active          = true;
    ctx.accounts.image_lock.active           = true;
    ctx.accounts.identity_lock.active        = true;
    ctx.accounts.identity_lock.locked_at     = clock.unix_timestamp;
    msg!("Protection activated for mint={:?}", ctx.accounts.token_registry.mint);
    Ok(())
}

pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
    let config = &ctx.accounts.dex_configuration_account;
    require!(
        ctx.accounts.authority.key() == config.protocol_wallet,
        CustomError::Unauthorized
    );
    ctx.accounts.token_registry.protected = false;
    ctx.accounts.ticker_lock.active       = false;
    ctx.accounts.image_lock.active        = false;
    ctx.accounts.identity_lock.active     = false;
    msg!("Protection deactivated for mint={:?}", ctx.accounts.token_registry.mint);
    Ok(())
}

// ─── ACCOUNT STRUCTS ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(ticker_hash: [u8; 32], image_hash: [u8; 32], identity_hash: [u8; 32], ticker_raw: [u8; 16])]
pub struct CreateTokenRegistry<'info> {
    #[account(
        init,
        space = TokenRegistry::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), mint.key().as_ref()],
        bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    /// CHECK: token mint
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker_hash: [u8; 32], image_hash: [u8; 32], identity_hash: [u8; 32])]
pub struct ClaimLocks<'info> {
    #[account(
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), token_registry.mint.as_ref()],
        bump = token_registry.bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    /// CHECK: seeded by ticker_hash — init fails if already claimed (first-deployer-wins)
    #[account(
        init,
        space = TickerLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &ticker_hash],
        bump,
    )]
    pub ticker_lock: UncheckedAccount<'info>,

    /// CHECK: seeded by image_hash — init fails if already claimed
    #[account(
        init,
        space = ImageLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &image_hash],
        bump,
    )]
    pub image_lock: UncheckedAccount<'info>,

    /// CHECK: seeded by identity_hash — init fails if already claimed
    #[account(
        init,
        space = IdentityLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [IdentityLock::SEED_PREFIX.as_bytes(), &identity_hash],
        bump,
    )]
    pub identity_lock: UncheckedAccount<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker_hash: [u8; 32], image_hash: [u8; 32], identity_hash: [u8; 32])]
pub struct RegisterToken<'info> {
    #[account(
        init,
        space = TokenRegistry::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), mint.key().as_ref()],
        bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    /// CHECK: seeded by ticker_hash — first-deployer-wins via init
    #[account(
        init,
        space = TickerLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &ticker_hash],
        bump,
    )]
    pub ticker_lock: UncheckedAccount<'info>,

    /// CHECK: seeded by image_hash — first-deployer-wins via init
    #[account(
        init,
        space = ImageLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &image_hash],
        bump,
    )]
    pub image_lock: UncheckedAccount<'info>,

    /// CHECK: seeded by identity_hash — first-deployer-wins via init
    #[account(
        init,
        space = IdentityLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [IdentityLock::SEED_PREFIX.as_bytes(), &identity_hash],
        bump,
    )]
    pub identity_lock: UncheckedAccount<'info>,

    /// CHECK: token mint
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateProtection<'info> {
    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    #[account(
        mut,
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), token_registry.mint.as_ref()],
        bump = token_registry.bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    #[account(
        mut,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &token_registry.ticker_hash],
        bump = ticker_lock.bump,
    )]
    pub ticker_lock: Box<Account<'info, TickerLock>>,

    #[account(
        mut,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &token_registry.image_hash],
        bump = image_lock.bump,
    )]
    pub image_lock: Box<Account<'info, ImageLock>>,

    #[account(
        mut,
        seeds = [IdentityLock::SEED_PREFIX.as_bytes(), &token_registry.identity_hash],
        bump = identity_lock.bump,
    )]
    pub identity_lock: Box<Account<'info, IdentityLock>>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateProtection<'info> {
    #[account(seeds = [CurveConfiguration::SEED.as_bytes()], bump)]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    #[account(
        mut,
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), token_registry.mint.as_ref()],
        bump = token_registry.bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    #[account(
        mut,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &token_registry.ticker_hash],
        bump = ticker_lock.bump,
    )]
    pub ticker_lock: Box<Account<'info, TickerLock>>,

    #[account(
        mut,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &token_registry.image_hash],
        bump = image_lock.bump,
    )]
    pub image_lock: Box<Account<'info, ImageLock>>,

    #[account(
        mut,
        seeds = [IdentityLock::SEED_PREFIX.as_bytes(), &token_registry.identity_hash],
        bump = identity_lock.bump,
    )]
    pub identity_lock: Box<Account<'info, IdentityLock>>,

    #[account(mut)]
    pub authority: Signer<'info>,
}