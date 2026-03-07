use crate::{consts::DEPLOY_FEE_LAMPORTS, errors::CustomError, state::*};
use anchor_lang::prelude::*;

pub fn initialize(
    ctx: Context<InitializeCurveConfiguration>,
    fees: f64,
    protocol_wallet: Pubkey,
    airdrop_wallet: Pubkey,
) -> Result<()> {
    let dex_config = &mut ctx.accounts.dex_configuration_account;

    if fees < 0_f64 || fees > 100_f64 {
        return err!(CustomError::InvalidFee);
    }

    // Seed the global PDA with some SOL for rent
    let _ = transfer_sol_to_pool(
        ctx.accounts.admin.to_account_info(),
        ctx.accounts.global_account.to_account_info(),
        10_000_000, // 0.01 SOL
        ctx.accounts.system_program.to_account_info(),
    );

    dex_config.set_inner(CurveConfiguration::new(fees, protocol_wallet, airdrop_wallet));

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeCurveConfiguration<'info> {
    #[account(
        init,
        space = CurveConfiguration::ACCOUNT_SIZE,
        payer = admin,
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
    pub dex_configuration_account: Box<Account<'info, CurveConfiguration>>,

    /// CHECK
    #[account(
        mut,
        seeds = [b"global"],
        bump,
    )]
    pub global_account: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}