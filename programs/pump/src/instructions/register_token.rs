use anchor_lang::prelude::*;

use crate::{
    errors::CustomError,
    registry::{IdentityLock, ImageLock, TickerLock, TokenRegistry},
    state::CurveConfiguration,
};

pub fn register_token(
    ctx: Context<RegisterToken>,
    ticker_hash: [u8; 32],
    image_hash: [u8; 32],
    identity_hash: [u8; 32],
    ticker_raw: [u8; 16],
) -> Result<()> {
    let clock = Clock::get()?;

    let registry = &mut ctx.accounts.token_registry;
    registry.mint = ctx.accounts.mint.key();
    registry.ticker_hash = ticker_hash;
    registry.image_hash = image_hash;
    registry.identity_hash = identity_hash;
    registry.ticker_raw = ticker_raw;
    registry.protected = false;
    registry.protected_at = 0;
    registry.creator = ctx.accounts.creator.key();
    registry.created_at = clock.unix_timestamp;
    registry.bump = ctx.bumps.token_registry;

    let ticker_lock = &mut ctx.accounts.ticker_lock;
    ticker_lock.registry = registry.key();
    ticker_lock.ticker_hash = ticker_hash;
    ticker_lock.active = false;
    ticker_lock.bump = ctx.bumps.ticker_lock;

    let image_lock = &mut ctx.accounts.image_lock;
    image_lock.registry = registry.key();
    image_lock.image_hash = image_hash;
    image_lock.active = false;
    image_lock.bump = ctx.bumps.image_lock;

    let identity_lock = &mut ctx.accounts.identity_lock;
    identity_lock.registry = registry.key();
    identity_lock.identity_hash = identity_hash;
    identity_lock.active = false;
    identity_lock.locked_at = 0;
    identity_lock.bump = ctx.bumps.identity_lock;

    msg!("Token registered: mint={:?}", ctx.accounts.mint.key());
    Ok(())
}

/// Keeper-only: activate protection when token MC > $100K.
/// Verifies the signer is the protocol_wallet from CurveConfiguration.
pub fn activate_protection(ctx: Context<ActivateProtection>) -> Result<()> {
    // Authority check: only protocol wallet can activate
    let config = &ctx.accounts.dex_configuration_account;
    require!(
        ctx.accounts.authority.key() == config.protocol_wallet,
        CustomError::Unauthorized
    );

    let clock = Clock::get()?;

    ctx.accounts.token_registry.protected = true;
    ctx.accounts.token_registry.protected_at = clock.unix_timestamp;
    ctx.accounts.ticker_lock.active = true;
    ctx.accounts.image_lock.active = true;
    ctx.accounts.identity_lock.active = true;
    ctx.accounts.identity_lock.locked_at = clock.unix_timestamp;

    msg!("Protection activated for mint={:?}", ctx.accounts.token_registry.mint);
    Ok(())
}

/// Keeper-only: deactivate protection when MC drops below $100K.
/// Verifies the signer is the protocol_wallet from CurveConfiguration.
pub fn deactivate_protection(ctx: Context<DeactivateProtection>) -> Result<()> {
    // Authority check: only protocol wallet can deactivate
    let config = &ctx.accounts.dex_configuration_account;
    require!(
        ctx.accounts.authority.key() == config.protocol_wallet,
        CustomError::Unauthorized
    );

    ctx.accounts.token_registry.protected = false;
    ctx.accounts.ticker_lock.active = false;
    ctx.accounts.image_lock.active = false;
    ctx.accounts.identity_lock.active = false;

    msg!("Protection deactivated for mint={:?}", ctx.accounts.token_registry.mint);
    Ok(())
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

    #[account(
        init,
        space = TickerLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [TickerLock::SEED_PREFIX.as_bytes(), &ticker_hash],
        bump,
    )]
    pub ticker_lock: Box<Account<'info, TickerLock>>,

    #[account(
        init,
        space = ImageLock::ACCOUNT_SIZE,
        payer = creator,
        seeds = [ImageLock::SEED_PREFIX.as_bytes(), &image_hash],
        bump,
    )]
    pub image_lock: Box<Account<'info, ImageLock>>,

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
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
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
    #[account(
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
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