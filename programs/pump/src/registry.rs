use anchor_lang::prelude::*;

/// Registry entry for each deployed token on SUMMIT.MOON.
/// Created at deploy time. Stores hashed metadata for anti-vamp checks.
/// The `protected` flag is set by the keeper when MC exceeds $100K,
/// which activates ticker/image/identity locks.
#[account]
pub struct TokenRegistry {
    pub mint: Pubkey,              // Token mint address
    pub ticker_hash: [u8; 32],     // SHA-256 of normalized uppercase ticker
    pub image_hash: [u8; 32],      // Perceptual hash of token image (computed off-chain)
    pub identity_hash: [u8; 32],   // SHA-256 of normalized identity (twitter/domain)
    pub ticker_raw: [u8; 16],      // Raw ticker string (max 16 chars, null-padded)
    pub protected: bool,           // True when MC > $100K (set by keeper)
    pub protected_at: i64,         // Timestamp when protection was activated
    pub creator: Pubkey,           // Who deployed this token
    pub created_at: i64,           // When the token was deployed
    pub bump: u8,
}

impl TokenRegistry {
    pub const SEED_PREFIX: &'static str = "token_registry";

    // Discriminator (8) + Pubkey (32) + [u8;32]*3 (96) + [u8;16] (16) 
    // + bool (1) + i64 (8) + Pubkey (32) + i64 (8) + u8 (1)
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 96 + 16 + 1 + 8 + 32 + 8 + 1;

    /// Check if this registry entry's ticker conflicts with a new ticker hash.
    /// Only blocks if this token is protected (MC > $100K).
    pub fn blocks_ticker(&self, new_ticker_hash: &[u8; 32]) -> bool {
        self.protected && self.ticker_hash == *new_ticker_hash
    }

    /// Check if this registry entry's image conflicts with a new image hash.
    /// Only blocks if this token is protected (MC > $100K).
    pub fn blocks_image(&self, new_image_hash: &[u8; 32]) -> bool {
        self.protected && self.image_hash == *new_image_hash
    }

    /// Check if this registry entry's identity conflicts with a new identity hash.
    /// Only blocks if this token is protected (MC > $100K).
    pub fn blocks_identity(&self, new_identity_hash: &[u8; 32]) -> bool {
        self.protected && self.identity_hash == *new_identity_hash
    }
}

/// Lightweight index PDA keyed by ticker hash.
/// Allows O(1) lookup: "does a protected token with this ticker already exist?"
/// Points back to the TokenRegistry PDA.
#[account]
pub struct TickerLock {
    pub registry: Pubkey,    // Points to the TokenRegistry account
    pub ticker_hash: [u8; 32],
    pub active: bool,        // Mirrors TokenRegistry.protected
    pub bump: u8,
}

impl TickerLock {
    pub const SEED_PREFIX: &'static str = "ticker_lock";
    // Discriminator (8) + Pubkey (32) + [u8;32] (32) + bool (1) + u8 (1)
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 1 + 1;
}

/// Lightweight index PDA keyed by image hash.
#[account]
pub struct ImageLock {
    pub registry: Pubkey,
    pub image_hash: [u8; 32],
    pub active: bool,
    pub bump: u8,
}

impl ImageLock {
    pub const SEED_PREFIX: &'static str = "image_lock";
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 1 + 1;
}

/// Lightweight index PDA keyed by identity hash.
#[account]
pub struct IdentityLock {
    pub registry: Pubkey,
    pub identity_hash: [u8; 32],
    pub active: bool,
    pub locked_at: i64,      // For 24hr cooldown
    pub bump: u8,
}

impl IdentityLock {
    pub const SEED_PREFIX: &'static str = "identity_lock";
    // Discriminator (8) + Pubkey (32) + [u8;32] (32) + bool (1) + i64 (8) + u8 (1)
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}

/// Source lock PDA: one tweet/article = one token.
/// First transaction to create this PDA wins.
/// Chain is the only authority — backend is just a signer oracle.
#[account]
pub struct SourceLock {
    pub source_hash: [u8; 32],     // SHA-256 of canonical key (e.g. "x:1234567890")
    pub image_phash: [u8; 8],      // 64-bit perceptual hash of source image
    pub mint: Pubkey,              // Token mint this source is locked to
    pub creator: Pubkey,           // Wallet that deployed the token
    pub created_at: i64,           // Slot timestamp when lock was created
    pub bump: u8,
}

impl SourceLock {
    pub const SEED_PREFIX: &'static str = "source_lock";

    // Discriminator (8) + [u8;32] (32) + [u8;8] (8) + Pubkey (32) + Pubkey (32) + i64 (8) + u8 (1)
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 8 + 32 + 32 + 8 + 1;
}