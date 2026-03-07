use crate::consts::{GRADUATION_THRESHOLD_LAMPORTS, LP_FEE_BPS, AIRDROP_FEE_BPS};
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
}

impl CurveConfiguration {
    pub const SEED: &'static str = "CurveConfiguration";
    // Discriminator (8) + f64 (8) + Pubkey (32) + Pubkey (32)
    pub const ACCOUNT_SIZE: usize = 8 + 8 + 32 + 32;

    pub fn new(fees: f64, protocol_wallet: Pubkey, airdrop_wallet: Pubkey) -> Self {
        Self { fees, protocol_wallet, airdrop_wallet }
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
    pub reserve_one: u64,      // Token reserve
    pub reserve_two: u64,      // SOL reserve (lamports)
    pub bump: u8,
    pub launch_timestamp: i64,
    pub graduated: bool,
    pub total_sol_raised: u64,
    pub creator: Pubkey,
    pub airdrop_pool: u64,
}

impl LiquidityPool {
    pub const POOL_SEED_PREFIX: &'static str = "liquidity_pool";

    // Discriminator (8) + Pubkey (32) + Pubkey (32) + u64 (8) + u64 (8) + u64 (8)
    // + u8 (1) + i64 (8) + bool (1) + u64 (8) + Pubkey (32) + u64 (8)
    // Adding 16 bytes padding for alignment safety
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 8 + 16;

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
        }
    }

    pub fn should_graduate(&self) -> bool {
        !self.graduated && self.total_sol_raised >= GRADUATION_THRESHOLD_LAMPORTS
    }
}

pub trait LiquidityPoolAccount<'info> {
    fn grant_shares(
        &mut self,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        shares: u64,
    ) -> Result<()>;

    fn remove_shares(
        &mut self,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        shares: u64,
    ) -> Result<()>;

    fn update_reserves(&mut self, reserve_one: u64, reserve_two: u64) -> Result<()>;

    fn add_liquidity(
        &mut self,
        token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut AccountInfo<'info>,
        ),
        amount_one: u64,
        amount_two: u64,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
    ) -> Result<()>;

    fn remove_liquidity(
        &mut self,
        token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut AccountInfo<'info>,
        ),
        shares: u64,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
    ) -> Result<()>;

    fn swap(
        &mut self,
        bonding_configuration_account: &Account<'info, CurveConfiguration>,
        token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut Signer<'info>,
        ),
        amount: u64,
        style: u64,
        bump: u8,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
        system_program: &Program<'info, System>,
    ) -> Result<()>;

    fn transfer_token_from_pool(
        &self,
        from: &Account<'info, TokenAccount>,
        to: &Account<'info, TokenAccount>,
        amount: u64,
        token_program: &Program<'info, Token>,
        authority: &AccountInfo<'info>,
        bump: u8,
    ) -> Result<()>;

    fn transfer_token_to_pool(
        &self,
        from: &Account<'info, TokenAccount>,
        to: &Account<'info, TokenAccount>,
        amount: u64,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
    ) -> Result<()>;

    fn transfer_sol_to_pool(
        &self,
        from: &Signer<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
        system_program: &Program<'info, System>,
    ) -> Result<()>;

    fn transfer_sol_from_pool_raw(
        &self,
        from: &AccountInfo<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()>;
}

impl<'info> LiquidityPoolAccount<'info> for Account<'info, LiquidityPool> {
    fn grant_shares(
        &mut self,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        shares: u64,
    ) -> Result<()> {
        liquidity_provider_account.shares = liquidity_provider_account
            .shares
            .checked_add(shares)
            .ok_or(CustomError::FailedToAllocateShares)?;
        self.total_supply = self
            .total_supply
            .checked_add(shares)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        Ok(())
    }

    fn remove_shares(
        &mut self,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        shares: u64,
    ) -> Result<()> {
        liquidity_provider_account.shares = liquidity_provider_account
            .shares
            .checked_sub(shares)
            .ok_or(CustomError::FailedToDeallocateShares)?;
        self.total_supply = self
            .total_supply
            .checked_sub(shares)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        Ok(())
    }

    fn update_reserves(&mut self, reserve_one: u64, reserve_two: u64) -> Result<()> {
        self.reserve_one = reserve_one;
        self.reserve_two = reserve_two;
        Ok(())
    }

    fn add_liquidity(
        &mut self,
        token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        _token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut AccountInfo<'info>,
        ),
        amount_one: u64,
        amount_two: u64,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
    ) -> Result<()> {
        let shares_to_allocate;

        if self.total_supply == 0 {
            let sqrt_shares = (convert_to_float(amount_one, token_one_accounts.0.decimals)
                .mul(convert_to_float(amount_two, 9 as u8)))
            .sqrt();
            shares_to_allocate = sqrt_shares as u64;
        } else {
            let mul_value = amount_one
                .checked_mul(self.total_supply)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let shares_one = mul_value
                .checked_div(self.reserve_one)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let mul_value = amount_two
                .checked_mul(self.total_supply)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let shares_two = mul_value
                .checked_div(self.reserve_two)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            shares_to_allocate = cmp::min(shares_one, shares_two);
        }

        if shares_to_allocate == 0 {
            return err!(CustomError::FailedToAddLiquidity);
        }

        self.grant_shares(liquidity_provider_account, shares_to_allocate)?;

        let new_reserves_one = self
            .reserve_one
            .checked_add(amount_one)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let new_reserves_two = self
            .reserve_two
            .checked_add(amount_two)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

        self.update_reserves(new_reserves_one, new_reserves_two)?;

        self.transfer_token_to_pool(
            token_one_accounts.2,
            token_one_accounts.1,
            amount_one,
            authority,
            token_program,
        )?;

        Ok(())
    }

    fn remove_liquidity(
        &mut self,
        _token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        _token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut AccountInfo<'info>,
        ),
        shares: u64,
        liquidity_provider_account: &mut Account<'info, LiquidityProvider>,
        _authority: &Signer<'info>,
        _token_program: &Program<'info, Token>,
    ) -> Result<()> {
        if shares == 0 {
            return err!(CustomError::FailedToRemoveLiquidity);
        }
        if liquidity_provider_account.shares < shares {
            return err!(CustomError::InsufficientShares);
        }

        let mul_value = shares
            .checked_mul(self.reserve_one)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let amount_out_one = mul_value
            .checked_div(self.total_supply)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

        let mul_value = shares
            .checked_mul(self.reserve_two)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let amount_out_two = mul_value
            .checked_div(self.total_supply)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

        if amount_out_one == 0 || amount_out_two == 0 {
            return err!(CustomError::FailedToRemoveLiquidity);
        }

        self.remove_shares(liquidity_provider_account, shares)?;

        let new_reserves_one = self
            .reserve_one
            .checked_sub(amount_out_one)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
        let new_reserves_two = self
            .reserve_two
            .checked_sub(amount_out_two)
            .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

        self.update_reserves(new_reserves_one, new_reserves_two)?;
        Ok(())
    }

    fn swap(
        &mut self,
        _bonding_configuration_account: &Account<'info, CurveConfiguration>,
        token_one_accounts: (
            &mut Account<'info, Mint>,
            &mut Account<'info, TokenAccount>,
            &mut Account<'info, TokenAccount>,
        ),
        token_two_accounts: (
            &mut Account<'info, Mint>,
            &mut AccountInfo<'info>,
            &mut Signer<'info>,
        ),
        amount: u64,
        style: u64,
        bump: u8,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
        system_program: &Program<'info, System>,
    ) -> Result<()> {
        if amount == 0 {
            return err!(CustomError::InvalidAmount);
        }

        // Block trading if graduated
        require!(!self.graduated, CustomError::AlreadyGraduated);

        msg!("Mint: {:?} ", token_one_accounts.0.key());
        msg!("Swap: {:?} {:?} {:?}", authority.key(), style, amount);

        let total_fee_pct = _bonding_configuration_account.fees;
        let adjusted_amount_in_float = convert_to_float(amount, token_one_accounts.0.decimals)
            .div(100_f64)
            .mul(100_f64.sub(total_fee_pct));
        let adjusted_amount =
            convert_from_float(adjusted_amount_in_float, token_one_accounts.0.decimals);

        // Fee split tracking
        let total_fee = amount.saturating_sub(adjusted_amount);
        let _lp_fee = total_fee * LP_FEE_BPS / 10000;
        let airdrop_fee = total_fee * AIRDROP_FEE_BPS / 10000;
        self.airdrop_pool = self.airdrop_pool.saturating_add(airdrop_fee);

        if style == 1 {
            // SELL: user sends tokens, receives SOL
            let denominator_sum = self
                .reserve_one
                .checked_add(adjusted_amount)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

            let div_amt = convert_to_float(denominator_sum, token_one_accounts.0.decimals).div(
                convert_to_float(adjusted_amount, token_one_accounts.0.decimals),
            );
            let amount_out_in_float = convert_to_float(self.reserve_two, 9 as u8).div(div_amt);
            let amount_out = convert_from_float(amount_out_in_float, 9 as u8);

            let new_reserves_one = self
                .reserve_one
                .checked_add(amount)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let new_reserves_two = self
                .reserve_two
                .checked_sub(amount_out)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

            self.update_reserves(new_reserves_one, new_reserves_two)?;
            msg!("Reserves: {:?} {:?}", new_reserves_one, new_reserves_two);

            // User sends tokens to pool
            self.transfer_token_to_pool(
                token_one_accounts.2, // user token account
                token_one_accounts.1, // pool token account
                amount,
                authority,
                token_program,
            )?;

            // FIX: Pool sends SOL to user via raw lamport transfer
            // token_two_accounts.1 = global PDA (FROM)
            // token_two_accounts.2 = user (TO)
            self.transfer_sol_from_pool_raw(
                token_two_accounts.1, // global PDA (source of SOL)
                &token_two_accounts.2.to_account_info(), // user (destination)
                amount_out,
            )?;
        } else {
            // BUY: user sends SOL, receives tokens
            let denominator_sum = self
                .reserve_two
                .checked_add(adjusted_amount)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

            let div_amt = convert_to_float(denominator_sum, token_one_accounts.0.decimals).div(
                convert_to_float(adjusted_amount, token_one_accounts.0.decimals),
            );
            let amount_out_in_float =
                convert_to_float(self.reserve_one, 9 as u8).div(div_amt);
            let amount_out = convert_from_float(amount_out_in_float, 9 as u8);

            // === MAX WALLET CHECK (anti-snipe) ===
            let clock = Clock::get()?;
            let elapsed = clock.unix_timestamp.saturating_sub(self.launch_timestamp);
            let total_tokens = token_one_accounts.0.supply;

            let max_bps: Option<u64> = if elapsed < 30 {
                Some(100) // 0-30s: 1% max wallet
            } else if elapsed < 120 {
                Some(200) // 30s-2min: 2% max wallet
            } else if elapsed < 300 {
                Some(500) // 2min-5min: 5% max wallet
            } else {
                None
            };

            if let Some(bps) = max_bps {
                let max_tokens = (total_tokens as u128)
                    .checked_mul(bps as u128)
                    .unwrap()
                    .checked_div(10_000)
                    .unwrap() as u64;
                let balance_after = token_one_accounts
                    .2
                    .amount
                    .checked_add(amount_out)
                    .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
                require!(
                    balance_after <= max_tokens,
                    CustomError::MaxWalletExceeded
                );
            }
            // === END MAX WALLET CHECK ===

            // Track SOL raised for graduation
            self.total_sol_raised = self.total_sol_raised.saturating_add(amount);

            let new_reserves_one = self
                .reserve_one
                .checked_sub(amount_out)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;
            let new_reserves_two = self
                .reserve_two
                .checked_add(amount)
                .ok_or(CustomError::OverflowOrUnderflowOccurred)?;

            self.update_reserves(new_reserves_one, new_reserves_two)?;
            msg!("Reserves: {:?} {:?}", new_reserves_one, new_reserves_two);

            // Pool sends tokens to user
            self.transfer_token_from_pool(
                token_one_accounts.1,
                token_one_accounts.2,
                amount_out,
                token_program,
                token_two_accounts.1,
                bump,
            )?;

            // User sends SOL to pool
            self.transfer_sol_to_pool(
                token_two_accounts.2,
                token_two_accounts.1,
                amount,
                system_program,
            )?;

            // Check graduation
            if self.should_graduate() {
                self.graduated = true;
                msg!("GRADUATED! Total SOL raised: {:?}", self.total_sol_raised);
            }
        }
        Ok(())
    }

    fn transfer_token_from_pool(
        &self,
        from: &Account<'info, TokenAccount>,
        to: &Account<'info, TokenAccount>,
        amount: u64,
        token_program: &Program<'info, Token>,
        authority: &AccountInfo<'info>,
        bump: u8,
    ) -> Result<()> {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                token::Transfer {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: authority.to_account_info(),
                },
                &[&["global".as_bytes(), &[bump]]],
            ),
            amount,
        )?;
        Ok(())
    }

    fn transfer_token_to_pool(
        &self,
        from: &Account<'info, TokenAccount>,
        to: &Account<'info, TokenAccount>,
        amount: u64,
        authority: &Signer<'info>,
        token_program: &Program<'info, Token>,
    ) -> Result<()> {
        token::transfer(
            CpiContext::new(
                token_program.to_account_info(),
                token::Transfer {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: authority.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    fn transfer_sol_to_pool(
        &self,
        from: &Signer<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
        system_program: &Program<'info, System>,
    ) -> Result<()> {
        system_program::transfer(
            CpiContext::new(
                system_program.to_account_info(),
                system_program::Transfer {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Transfer SOL from a PDA using raw lamport manipulation.
    /// This works even when the PDA is not system-owned (e.g. holds token accounts).
    fn transfer_sol_from_pool_raw(
        &self,
        from: &AccountInfo<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()? += amount;
        Ok(())
    }
}

pub fn transfer_sol_to_pool<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    amount: u64,
    system_program: AccountInfo<'info>,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            system_program::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
            },
        ),
        amount,
    )?;
    Ok(())
}