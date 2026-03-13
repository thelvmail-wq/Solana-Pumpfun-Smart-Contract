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
            let s = (convert_to_float(a1, t1.0.decimals).mul(convert_to_float(a2, 9u8))).sqrt();
            shares = s as u64;
        } else {
            let s1 = a1.checked_mul(self.total_supply).ok_or(CustomError::OverflowOrUnderflowOccurred)?.checked_div(self.reserve_one).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let s2 = a2.checked_mul(self.total_supply).ok_or(CustomError::OverflowOrUnderflowOccurred)?.checked_div(self.reserve_two).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            shares = cmp::min(s1, s2);
        }
        if shares == 0 { return err!(CustomError::FailedToAddLiquidity); }
        self.grant_shares(lp, shares)?;
        let nr1 = self.reserve_one.checked_add(a1).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let nr2 = self.reserve_two.checked_add(a2).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        self.update_reserves(nr1, nr2)?;
        self.transfer_token_to_pool(t1.2, t1.1, a1, auth, tp)?;
        Ok(())
    }
    fn remove_liquidity(&mut self, _t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), _t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut AccountInfo<'info>), shares: u64, lp: &mut Account<'info, LiquidityProvider>, _auth: &Signer<'info>, _tp: &Program<'info, Token>) -> Result<()> {
        if shares == 0 { return err!(CustomError::FailedToRemoveLiquidity); }
        if lp.shares < shares { return err!(CustomError::InsufficientShares); }
        let o1 = shares.checked_mul(self.reserve_one).ok_or(CustomError::OverflowOrUnderflowOccurred)?.checked_div(self.total_supply).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let o2 = shares.checked_mul(self.reserve_two).ok_or(CustomError::OverflowOrUnderflowOccurred)?.checked_div(self.total_supply).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        if o1 == 0 || o2 == 0 { return err!(CustomError::FailedToRemoveLiquidity); }
        self.remove_shares(lp, shares)?;
        let nr1 = self.reserve_one.checked_sub(o1).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let nr2 = self.reserve_two.checked_sub(o2).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        self.update_reserves(nr1, nr2)?;
        Ok(())
    }
    fn swap(&mut self, _config: &Account<'info, CurveConfiguration>, t1: (&mut Account<'info, Mint>, &mut Account<'info, TokenAccount>, &mut Account<'info, TokenAccount>), t2: (&mut Account<'info, Mint>, &mut AccountInfo<'info>, &mut Signer<'info>), amount: u64, style: u64, bump: u8, auth: &Signer<'info>, tp: &Program<'info, Token>, sp: &Program<'info, System>) -> Result<()> {
        if amount == 0 { return err!(CustomError::InvalidAmount); }
        require!(!self.graduated, CustomError::AlreadyGraduated);
        msg!("Mint: {:?} ", t1.0.key());
        msg!("Swap: {:?} {:?} {:?}", auth.key(), style, amount);
        let fee_pct = _config.fees;
        let adj_f = convert_to_float(amount, t1.0.decimals).div(100_f64).mul(100_f64.sub(fee_pct));
        let adj = convert_from_float(adj_f, t1.0.decimals);
        let total_fee = amount.saturating_sub(adj);
        let _lp_fee = total_fee * LP_FEE_BPS / 10000;
        let airdrop_fee = total_fee * AIRDROP_FEE_BPS / 10000;
        self.airdrop_pool = self.airdrop_pool.saturating_add(airdrop_fee);

        if style == 1 {
            // SELL: user sends tokens, gets SOL back
            let denom = self.reserve_one.checked_add(adj).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let div_amt = convert_to_float(denom, t1.0.decimals).div(convert_to_float(adj, t1.0.decimals));
            let out_f = convert_to_float(self.reserve_two, 9u8).div(div_amt);
            let amount_out = convert_from_float(out_f, 9u8);
            let nr1 = self.reserve_one.checked_add(amount).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let nr2 = self.reserve_two.checked_sub(amount_out).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            self.update_reserves(nr1, nr2)?;
            msg!("Reserves: {:?} {:?}", nr1, nr2);
            self.transfer_token_to_pool(t1.2, t1.1, amount, auth, tp)?;
            system_program::transfer(
                CpiContext::new_with_signer(
                    sp.to_account_info(),
                    system_program::Transfer {
                        from: t2.1.clone(),
                        to: t2.2.to_account_info(),
                    },
                    &[&[b"global", &[bump]]],
                ),
                amount_out,
            )?;
        } else {
            // BUY: user sends SOL, gets tokens
            let denom = self.reserve_two.checked_add(adj).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let div_amt = convert_to_float(denom, t1.0.decimals).div(convert_to_float(adj, t1.0.decimals));
            let out_f = convert_to_float(self.reserve_one, 9u8).div(div_amt);
            let amount_out = convert_from_float(out_f, 9u8);
            // ── Anti-snipe: updated windows from consts ──
            let clock = Clock::get()?;
            let elapsed = clock.unix_timestamp.saturating_sub(self.launch_timestamp);
            let total_tokens = t1.0.supply;
            let max_bps: Option<u64> = if elapsed < SNIPE_WINDOW_1 {
                Some(SNIPE_BPS_1)       // 0-2 min: 1.5%
            } else if elapsed < SNIPE_WINDOW_2 {
                Some(SNIPE_BPS_2)       // 2-5 min: 2.5%
            } else if elapsed < SNIPE_WINDOW_3 {
                Some(SNIPE_BPS_3)       // 5-10 min: 5%
            } else {
                None                     // 10+ min: open
            };
            if let Some(bps) = max_bps {
                let max_t = (total_tokens as u128).checked_mul(bps as u128).unwrap().checked_div(10_000).unwrap() as u64;
                let bal_after = t1.2.amount.checked_add(amount_out).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
                require!(bal_after <= max_t, CustomError::MaxWalletExceeded);
            }
            self.total_sol_raised = self.total_sol_raised.saturating_add(amount);
            let nr1 = self.reserve_one.checked_sub(amount_out).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let nr2 = self.reserve_two.checked_add(amount).ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            self.update_reserves(nr1, nr2)?;
            msg!("Reserves: {:?} {:?}", nr1, nr2);
            self.transfer_token_from_pool(t1.1, t1.2, amount_out, tp, t2.1, bump)?;
            self.transfer_sol_to_pool(t2.2, t2.1, amount, sp)?;
            if self.should_graduate() {
                self.graduated = true;
                self.graduation_ts = clock.unix_timestamp;
                msg!("GRADUATED! Total SOL raised: {:?}", self.total_sol_raised);
            }
        }
        Ok(())
    }
    fn transfer_token_from_pool(&self, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, amount: u64, tp: &Program<'info, Token>, auth: &AccountInfo<'info>, bump: u8) -> Result<()> {
        token::transfer(CpiContext::new_with_signer(tp.to_account_info(), token::Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: auth.to_account_info() }, &[&[b"global", &[bump]]]), amount)?;
        Ok(())
    }
    fn transfer_token_to_pool(&self, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, amount: u64, auth: &Signer<'info>, tp: &Program<'info, Token>) -> Result<()> {
        token::transfer(CpiContext::new(tp.to_account_info(), token::Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: auth.to_account_info() }), amount)?;
        Ok(())
    }
    fn transfer_sol_to_pool(&self, from: &Signer<'info>, to: &AccountInfo<'info>, amount: u64, sp: &Program<'info, System>) -> Result<()> {
        system_program::transfer(CpiContext::new(sp.to_account_info(), system_program::Transfer { from: from.to_account_info(), to: to.to_account_info() }), amount)?;
        Ok(())
    }
}

pub fn transfer_sol_to_pool<'info>(from: AccountInfo<'info>, to: AccountInfo<'info>, amount: u64, sp: AccountInfo<'info>) -> Result<()> {
    system_program::transfer(CpiContext::new(sp.to_account_info(), system_program::Transfer { from: from.to_account_info(), to: to.to_account_info() }), amount)?;
    Ok(())
}
