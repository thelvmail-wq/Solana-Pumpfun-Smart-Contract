use anchor_lang::prelude::*;

#[error_code]
pub enum CustomError {
    #[msg("Duplicate tokens are not allowed")]
    DuplicateTokenNotAllowed,

    #[msg("Failed to allocate shares")]
    FailedToAllocateShares,

    #[msg("Failed to deallocate shares")]
    FailedToDeallocateShares,

    #[msg("Insufficient shares")]
    InsufficientShares,

    #[msg("Insufficient funds to swap")]
    InsufficientFunds,

    #[msg("Invalid amount to swap")]
    InvalidAmount,

    #[msg("Invalid fee")]
    InvalidFee,

    #[msg("Failed to add liquidity")]
    FailedToAddLiquidity,

    #[msg("Failed to remove liquidity")]
    FailedToRemoveLiquidity,

    #[msg("Overflow or underflow occured")]
    OverflowOrUnderflowOccurred,

    #[msg("Purchase would exceed max wallet limit")]
    MaxWalletExceeded,

    #[msg("Bonding curve has already graduated")]
    AlreadyGraduated,

    #[msg("Bonding curve has not graduated yet")]
    NotGraduated,

    #[msg("No tokens available to claim")]
    NoTokensAvailable,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Graduation threshold not reached")]
    GraduationThresholdNotReached,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Ticker is locked by a protected token")]
    TickerLocked,

    #[msg("Image is locked by a protected token")]
    ImageLocked,

    #[msg("Identity is locked by a protected token")]
    IdentityLocked,

    #[msg("Identity lock cooldown has not expired")]
    IdentityCooldownActive,

    #[msg("No deploy slots available")]
    NoSlotsAvailable,

    // === NEW: Migration errors ===
    #[msg("Pool has already been migrated to Meteora")]
    AlreadyMigrated,

    #[msg("Migration has not been completed by the bot yet")]
    MigrationNotComplete,

    // === NEW: Source lock / anti-vamp errors ===
    #[msg("Ed25519 signature verification failed")]
    Ed25519VerificationFailed,

    #[msg("Source lock signature has expired")]
    SignatureExpired,

    #[msg("Invalid signer for source lock")]
    InvalidSigner,

    #[msg("Source is already locked by another token")]
    SourceAlreadyLocked,
}
