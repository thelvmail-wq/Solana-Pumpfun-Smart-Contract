use crate::consts::{GRADUATION_THRESHOLD_LAMPORTS, LP_FEE_BPS, AIRDROP_FEE_BPS, SNIPE_WINDOW_1, SNIPE_WINDOW_2, SNIPE_WINDOW_3, SNIPE_BPS_1, SNIPE_BPS_2, SNIPE_BPS_3};
use crate::errors::CustomError;
use crate::utils::convert_from_float;
use crate::utils::convert_to_float;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use std::cmp;
use std::ops::Div;
use std::ops::Mul;
use std::ops::Sub;

#[account]
pub struct CurveConfiguration {
    pub fees: f64,
    pub protocol_wallet: Pubkey,
    pub airdrop_wallet: Pubkey,
    pub antivamp_signer: Pubkey,
}

impl CurveConfiguration {
    pub const SEED: &'static str = "CurveConfiguration";
    // 8 discriminator + 8 fees + 32 protocol + 32 airdrop + 32 antivamp
    pub const ACCOUNT_SIZE: usize = 8 + 8 + 32 + 32 + 32;
    pub fn new(fees: f64, protocol_wallet: Pubkey, airdrop_wallet: Pubkey) -> Self {
        Self {
            fees,
            protocol_wallet,
            airdrop_wallet,
            antivamp_signer: Pubkey::default(),
        }
    }
}

#[account]
pub struct LiquidityProvider {
    pub shares: u64,
}

impl LiquidityProvider {
    pub const SEED_PREFIX: &'static str = "LiqudityProvider";
    pub const ACCOUNT_SIZE: usize = 8 + 8;
}

#[account]
pub struct LiquidityPool {
    pub token_one: Pubkey,
    pub token_two: Pubkey,
    pub total_supply: u64,
    pub reserve_one: u64,
    pub reserve_two: u64,
    pub bump: u8,
    pub launch_timestamp: i64,
    pub graduated: bool,
    pub total_sol_raised: u64,
    pub creator: Pubkey,
    pub airdrop_pool: u64,
    // ── Graduation fields ──
    pub graduation_ts: i64,
    pub meteora_pool: Pubkey,
    pub migration_complete: bool,
}

impl LiquidityPool {
    pub const POOL_SEED_PREFIX: &'static str = "liquidity_pool";
    // 8 disc + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 8 + 8 + 32 + 1 + 16 padding
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 8 + 8 + 32 + 1 + 16;
    pub fn new(token_one: Pubkey, bump: u8, creator: Pubkey) -> Self {
        Self {
            token_one,
            token_two: token_one,
            total_supply: 0_u64,
            reserve_one: 0_u64,
            reserve_two: 0_u64,
            bump,
            launch_timestamp: Clock::get().unwrap().unix_timestamp,
            graduated: false,
            total_sol_raised: 0_u64,
            creator,
            airdrop_pool: 0_u64,
            graduation_ts: 0,
            meteora_pool: Pubkey::default(),
            migration_complete: false,
        }
    }
    pub fn should_graduate(&self) -> bool {
        !self.graduated && self.total_sol_raised >= GRADUATION_THRESHOLD_LAMPORTS
    }
}

pub trait LiquidityPoolAccount<'info> {
    fn grant_shares(&mut self, lp: &mut Account<'info, LiquidityProvider>, shares: u64) -> Result<()>;
    fn remove_shares(&mut self, lp: &mut Account<'info, LiquidityProvider>, shares: u64) -> Result<()>;
    fn update_reserves(&mut self, r1: u64, r2: u64) -> Result<()>;
    fn add_liquidity(&mut self, t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut AccountInfo<'info>), a1: u64, a2: u64, lp: &mut Account<'info, LiquidityProvider>, auth: &Signer<'info>, tp: &Program<'info, Token>) -> Result<()>;
    fn remove_liquidity(&mut self, t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut AccountInfo<'info>), shares: u64, lp: &mut Account<'info, LiquidityProvider>, auth: &Signer<'info>, tp: &Program<'info, Token>) -> Result<()>;
    fn swap(&mut self, config: &Account<'info, CurveConfiguration>, t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut Signer<'info>), amount: u64, style: u64, bump: u8, auth: &Signer<'info>, tp: &Program<'info, Token>, sp: &Program<'info, System>) -> Result<()>;
    fn transfer_token_from_pool(&self, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, amount: u64, tp: &Program<'info, Token>, auth: &AccountInfo<'info>, bump: u8) -> Result<()>;
    fn transfer_token_to_pool(&self, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, amount: u64, auth: &Signer<'info>, tp: &Program<'info, Token>) -> Result<()>;
    fn transfer_sol_to_pool(&self, from: &Signer<'info>, to: &AccountInfo<'info>, amount: u64, sp: &Program<'info, System>) -> Result<()>;
}

impl<'info> LiquidityPoolAccount<'info> for Account<'info, LiquidityPool> {
    fn grant_shares(&mut self, lp: &mut Account<'info, LiquidityProvider>, shares: u64) -> Result<()> {
        lp.shares = lp.shares.checked_add(shares).ok_or(CustomError::FailedToAllocateShares)?;
        self.total_supply = self.total_supply.checked_add(shares).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        Ok(())
    }
    fn remove_shares(&mut self, lp: &mut Account<'info, LiquidityProvider>, shares: u64) -> Result<()> {
        lp.shares = lp.shares.checked_sub(shares).ok_or(CustomError::FailedToDeallocateShares)?;
        self.total_supply = self.total_supply.checked_sub(shares).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        Ok(())
    }
    fn update_reserves(&mut self, r1: u64, r2: u64) -> Result<()> {
        self.reserve_one = r1;
        self.reserve_two = r2;
        Ok(())
    }
    fn add_liquidity(&mut self, t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), _t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut AccountInfo<'info>), a1: u64, a2: u64, lp: &mut Account<'info, LiquidityProvider>, auth: &Signer<'info>, tp: &Program<'info, Token>) -> Result<()> {
        let shares;
        if self.total_supply == 0 {
            let s = (convert_to_float(a1, t1.0.decimals).mul(convert_to_float(a2, 9u8
