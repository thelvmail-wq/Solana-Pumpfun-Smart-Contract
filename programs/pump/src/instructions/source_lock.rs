use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_lang::solana_program::ed25519_program;

use crate::registry::SourceLock;
use crate::state::CurveConfiguration;
use crate::errors::CustomError;
use crate::consts::SIGNATURE_TTL_SECS;

/// Create a source lock PDA.
/// 
/// One tweet/article = one CA. First transaction wins.
/// 
/// The backend signs a 112-byte payload:
///   source_hash (32) + image_phash (8) + mint (32) + creator (32) + expiry_timestamp (8)
/// 
/// This instruction verifies:
///   1. An Ed25519 verify instruction exists earlier in the same transaction
///   2. The signed message matches the reconstructed payload
///   3. The signer pubkey matches the one stored in the global config (protocol_wallet for now)
///   4. The signature hasn't expired
///   5. The PDA doesn't already exist (Anchor handles this via init)
///
pub fn create_source_lock(
    ctx: Context<CreateSourceLock>,
    source_hash: [u8; 32],
    image_phash: [u8; 8],
    expiry_timestamp: i64,
    ed25519_sig: [u8; 64],
    ed25519_pubkey: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    
    // 1. Check signature hasn't expired
    require!(
        clock.unix_timestamp <= expiry_timestamp,
        CustomError::SignatureExpired
    );
    
    // 2. Check expiry is within reasonable TTL (prevent far-future signatures)
    require!(
        expiry_timestamp <= clock.unix_timestamp + SIGNATURE_TTL_SECS + 30, // 30s grace for clock skew
        CustomError::SignatureExpired
    );

    // 3. Reconstruct the 112-byte payload that the backend signed
    let mint_bytes = ctx.accounts.mint.key().to_bytes();
    let creator_bytes = ctx.accounts.creator.key().to_bytes();
    let expiry_bytes = expiry_timestamp.to_le_bytes();
    
    let mut message = [0u8; 112];
    message[0..32].copy_from_slice(&source_hash);
    message[32..40].copy_from_slice(&image_phash);
    message[40..72].copy_from_slice(&mint_bytes);
    message[72..104].copy_from_slice(&creator_bytes);
    message[104..112].copy_from_slice(&expiry_bytes);

    // 4. Verify the Ed25519 instruction exists in the transaction
    //    The frontend must include an Ed25519Program.createInstructionWithPublicKey()
    //    as the FIRST instruction in the transaction, before this instruction.
    let ix_sysvar_info = &ctx.accounts.instruction_sysvar;
    verify_ed25519_ix(ix_sysvar_info, &ed25519_pubkey, &message, &ed25519_sig)?;

    // 5. Verify the signer pubkey matches the protocol's anti-vamp signer
    //    We store this in the CurveConfiguration.protocol_wallet for now.
    //    In production, you'd add a dedicated `antivamp_signer` field to global config.
    let config = &ctx.accounts.dex_config;
    let expected_signer = config.protocol_wallet;
    let actual_signer = Pubkey::new_from_array(ed25519_pubkey);
    require!(
        actual_signer == expected_signer,
        CustomError::InvalidSigner
    );

    // 6. Write the source lock PDA
    let lock = &mut ctx.accounts.source_lock;
    lock.source_hash = source_hash;
    lock.image_phash = image_phash;
    lock.mint = ctx.accounts.mint.key();
    lock.creator = ctx.accounts.creator.key();
    lock.created_at = clock.unix_timestamp;
    lock.bump = ctx.bumps.source_lock;

    msg!("SOURCE_LOCK created: mint={} creator={}", 
        ctx.accounts.mint.key(), 
        ctx.accounts.creator.key()
    );

    Ok(())
}

/// Verify that an Ed25519 signature verification instruction exists
/// in the transaction's instruction sysvar.
/// 
/// The Ed25519 precompile instruction format:
///   - byte 0: num_signatures (u8)
///   - bytes 2..4: signature_offset (u16 LE)
///   - bytes 4..6: signature_ix_index (u16 LE) — 0xFFFF means same instruction
///   - bytes 6..8: pubkey_offset (u16 LE)
///   - bytes 8..10: pubkey_ix_index (u16 LE)
///   - bytes 10..12: message_offset (u16 LE)
///   - bytes 12..14: message_ix_index (u16 LE)
///   - bytes 14..16: message_size (u16 LE)
///   Then the actual data: signature (64) + pubkey (32) + message (N)
///
fn verify_ed25519_ix(
    ix_sysvar: &AccountInfo,
    expected_pubkey: &[u8; 32],
    expected_message: &[u8; 112],
    expected_sig: &[u8; 64],
) -> Result<()> {
    let current_ix = ix_sysvar::load_current_index_checked(ix_sysvar)
        .map_err(|_| CustomError::Ed25519VerificationFailed)?;
    
    // The Ed25519 instruction must be BEFORE this instruction in the transaction
    require!(current_ix > 0, CustomError::Ed25519VerificationFailed);
    
    // Check previous instructions for an Ed25519 program instruction
    let mut found = false;
    for i in 0..current_ix {
        let ix = ix_sysvar::load_instruction_at_checked(i as usize, ix_sysvar)
            .map_err(|_| CustomError::Ed25519VerificationFailed)?;
        
        if ix.program_id != ed25519_program::id() {
            continue;
        }
        
        // Found an Ed25519 instruction — verify its contents
        let ix_data = &ix.data;
        
        // Minimum size: header (16) + signature (64) + pubkey (32) + message (112) = 224
        require!(ix_data.len() >= 224, CustomError::Ed25519VerificationFailed);
        
        // Parse header
        let num_sigs = ix_data[0];
        require!(num_sigs == 1, CustomError::Ed25519VerificationFailed);
        
        // The standard layout after the 16-byte header:
        // offset 16: signature (64 bytes)
        // offset 80: pubkey (32 bytes)  
        // offset 112: message (112 bytes)
        let sig_offset = u16::from_le_bytes([ix_data[2], ix_data[3]]) as usize;
        let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
        let msg_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
        let msg_size = u16::from_le_bytes([ix_data[14], ix_data[15]]) as usize;
        
        // Verify message size
        require!(msg_size == 112, CustomError::Ed25519VerificationFailed);
        
        // Bounds check
        require!(
            sig_offset + 64 <= ix_data.len() 
            && pubkey_offset + 32 <= ix_data.len()
            && msg_offset + msg_size <= ix_data.len(),
            CustomError::Ed25519VerificationFailed
        );
        
        // Extract and compare
        let sig = &ix_data[sig_offset..sig_offset + 64];
        let pubkey = &ix_data[pubkey_offset..pubkey_offset + 32];
        let message = &ix_data[msg_offset..msg_offset + msg_size];
        
        // Verify signature matches
        require!(sig == expected_sig, CustomError::Ed25519VerificationFailed);
        
        // Verify pubkey matches
        require!(pubkey == expected_pubkey, CustomError::Ed25519VerificationFailed);
        
        // Verify message matches our reconstructed payload
        require!(message == expected_message, CustomError::Ed25519VerificationFailed);
        
        found = true;
        break;
    }
    
    require!(found, CustomError::Ed25519VerificationFailed);
    Ok(())
}

#[derive(Accounts)]
#[instruction(source_hash: [u8; 32])]
pub struct CreateSourceLock<'info> {
    /// The source lock PDA — seeded by source_hash.
    /// If this PDA already exists, Anchor will reject the tx (init constraint).
    /// This is the atomic first-writer-wins mechanic.
    #[account(
        init,
        payer = creator,
        space = SourceLock::ACCOUNT_SIZE,
        seeds = [SourceLock::SEED_PREFIX.as_bytes(), &source_hash],
        bump,
    )]
    pub source_lock: Account<'info, SourceLock>,

    /// The global config — used to verify the anti-vamp signer pubkey
    #[account(
        seeds = [CurveConfiguration::SEED.as_bytes()],
        bump,
    )]
    pub dex_config: Account<'info, CurveConfiguration>,

    /// The token mint being locked to this source
    /// CHECK: We just read the key, no deserialization needed
    pub mint: AccountInfo<'info>,

    /// The deployer wallet — must be signer, pays rent for the PDA
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The instruction sysvar — needed to read Ed25519 precompile instructions
    /// CHECK: This is the instructions sysvar
    #[account(address = ix_sysvar::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}