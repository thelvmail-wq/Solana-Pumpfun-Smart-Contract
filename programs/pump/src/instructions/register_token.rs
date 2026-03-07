use anchor_lang::prelude::*;

use crate::{
    errors::CustomError,
    registry::{IdentityLock, ImageLock, TickerLock, TokenRegistry},
};

/// Called at deploy time (alongside add_liquidity).
/// Creates the TokenRegistry PDA for the new token and the three lock index PDAs.
/// Checks that no existing protected token holds a conflicting ticker, image, or identity.
///
/// The ticker_hash, image_hash, and identity_hash are computed OFF-CHAIN by the frontend/backend:
///   - ticker_hash:   SHA-256(normalize(ticker))    e.g. SHA-256("PUNCH")
///   - image_hash:    perceptual hash of the image  (dhash/phash, 256-bit)
///   - identity_hash: SHA-256(normalize(identity))  e.g. SHA-256("punchthemonkey")
///   - ticker_raw:    raw ticker bytes (max 16 chars)
///
/// Lock checking flow:
///   1. Frontend computes hashes
///   2. Frontend derives the TickerLock PDA from the ticker_hash
///   3. If that PDA exists and is active → blocked, don't even send the tx
///   4. If it doesn't exist → pass remaining_accounts with any potential conflicts
///   5. On-chain: we create the registry + lock PDAs (init = guaranteed unique seeds)
///   6. If a TickerLock PDA with the same seed already exists → Anchor init fails → blocked
///
/// This means: the lock IS the PDA existence. If a protected token has ticker hash X,
/// there's a TickerLock PDA seeded with X. Trying to create another with the same seed fails.
pub fn register_token(
    ctx: Context<RegisterToken>,
    ticker_hash: [u8; 32],
    image_hash: [u8; 32],
    identity_hash: [u8; 32],
    ticker_raw: [u8; 16],
) -> Result<()> {
    let clock = Clock::get()?;

    // Initialize the token registry
    let registry = &mut ctx.accounts.token_registry;
    registry.mint = ctx.accounts.mint.key();
    registry.ticker_hash = ticker_hash;
    registry.image_hash = image_hash;
    registry.identity_hash = identity_hash;
    registry.ticker_raw = ticker_raw;
    registry.protected = false; // Starts unprotected, keeper sets this when MC > $100K
    registry.protected_at = 0;
    registry.creator = ctx.accounts.creator.key();
    registry.created_at = clock.unix_timestamp;
    registry.bump = ctx.bumps.token_registry;

    // Initialize ticker lock index (unprotected initially)
    let ticker_lock = &mut ctx.accounts.ticker_lock;
    ticker_lock.registry = registry.key();
    ticker_lock.ticker_hash = ticker_hash;
    ticker_lock.active = false;
    ticker_lock.bump = ctx.bumps.ticker_lock;

    // Initialize image lock index
    let image_lock = &mut ctx.accounts.image_lock;
    image_lock.registry = registry.key();
    image_lock.image_hash = image_hash;
    image_lock.active = false;
    image_lock.bump = ctx.bumps.image_lock;

    // Initialize identity lock index
    let identity_lock = &mut ctx.accounts.identity_lock;
    identity_lock.registry = registry.key();
    identity_lock.identity_hash = identity_hash;
    identity_lock.active = false;
    identity_lock.locked_at = 0;
    identity_lock.bump = ctx.bumps.identity_lock;

    msg!(
        "Token registered: mint={:?}, ticker_hash={:?}, protected=false",
        ctx.accounts.mint.key(),
        ticker_hash
    );

    Ok(())
}

/// Keeper-only instruction to activate protection on a token when MC > $100K.
/// Sets protected=true on the registry and active=true on all lock PDAs.
/// Once active, no new token can deploy with the same ticker/image/identity hash.
pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
    let clock = Clock::get()?;

    let registry = &mut ctx.accounts.token_registry;
    registry.protected = true;
    registry.protected_at = clock.unix_timestamp;

    let ticker_lock = &mut ctx.accounts.ticker_lock;
    ticker_lock.active = true;

    let image_lock = &mut ctx.accounts.image_lock;
    image_lock.active = true;

    let identity_lock = &mut ctx.accounts.identity_lock;
    identity_lock.active = true;
    identity_lock.locked_at = clock.unix_timestamp;

    msg!(
        "Protection activated for mint={:?} at ts={}",
        registry.mint,
        clock.unix_timestamp
    );

    Ok(())
}

/// Keeper-only instruction to deactivate protection when MC drops below $100K.
/// Unlocks all three lock PDAs so the ticker/image/identity can be reused.
pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
    let registry = &mut ctx.accounts.token_registry;
    registry.protected = false;

    let ticker_lock = &mut ctx.accounts.ticker_lock;
    ticker_lock.active = false;

    let image_lock = &mut ctx.accounts.image_lock;
    image_lock.active = false;

    let identity_lock = &mut ctx.accounts.identity_lock;
    identity_lock.active = false;

    msg!("Protection deactivated for mint={:?}", registry.mint);

    Ok(())
}

#[derive(Accounts)]
#[instruction(ticker_hash: [u8; 32], image_hash: [u8; 32], identity_hash: [u8; 32])]
pub struct RegisterToken<'info> {
    /// The token registry PDA, seeded by the mint address.
    /// One per token, stores all hashes and protection status.
    #[account(
        init,
        space = TokenRegistry::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TokenRegistry::SEED_PREFIX.as_bytes(), mint.key().as_ref()],
        bump,
    )]
    pub token_registry: Box<Account<'info, TokenRegistry>>,

    /// Ticker lock index PDA, seeded by the ticker hash.
    /// If another protected token already has this ticker hash,
    /// Anchor's `init` will fail because the PDA already exists → deploy blocked.
    #[account(
        init,
        space = TickerLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &ticker_hash],
        bump,
    )]
    pub ticker_lock: Box<Account<'info, TickerLock>>,

    /// Image lock index PDA, seeded by the image hash.
    #[account(
        init,
        space = ImageLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &image_hash],
        bump,
    )]
    pub image_lock: Box<Account<'info, ImageLock>>,

    /// Identity lock index PDA, seeded by the identity hash.
    #[account(
        init,
        space = IdentityLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [IdentityLock::SEED_PREFIX.as_bytes(), &identity_hash],
        bump,
    )]
    pub identity_lock: Box<Account<'info, IdentityLock>>,

    /// CHECK: The token mint
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateProtection<'info> {
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

    /// Keeper/admin signer — only authorized wallets can activate protection.
    /// In production, check this against a stored admin key in CurveConfiguration.
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateProtection<'info> {
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