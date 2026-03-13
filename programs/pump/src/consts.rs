/// Initial price: lamports per one token (without decimals)
pub const INITIAL_PRICE: u64 = 600;

/// Graduation threshold: 89 SOL in lamports
pub const GRADUATION_THRESHOLD_LAMPORTS: u64 = 89_000_000_000;

/// Deploy fee: 1.5 SOL in lamports
pub const DEPLOY_FEE_LAMPORTS: u64 = 1_500_000_000;

/// Fee split basis points (out of 10000)
/// Total swap fee is 1.5% (150 bps), split as:
///   0.60% LP auto-compound  = 4000 / 10000 of the fee
///   0.50% airdrop pool      = 3333 / 10000 of the fee
///   0.40% protocol          = 2667 / 10000 of the fee
pub const LP_FEE_BPS: u64 = 4000;
pub const AIRDROP_FEE_BPS: u64 = 3333;
pub const PROTOCOL_FEE_BPS: u64 = 2667;

/// Deploy fee split (out of 100)
pub const DEPLOY_LP_PCT: u64 = 50;
pub const DEPLOY_PROTOCOL_PCT: u64 = 30;
pub const DEPLOY_AIRDROP_PCT: u64 = 10;
pub const DEPLOY_INFRA_PCT: u64 = 10;

/// ── Anti-snipe windows (UPDATED) ──────────────────────
/// 0-2 min  = 1.5% max wallet (150 bps)
/// 2-5 min  = 2.5% max wallet (250 bps)
/// 5-10 min = 5%   max wallet (500 bps)
/// 10+ min  = open (no cap)
pub const SNIPE_WINDOW_1: i64 = 120;   // 0 → 2 min
pub const SNIPE_WINDOW_2: i64 = 300;   // 2 → 5 min
pub const SNIPE_WINDOW_3: i64 = 600;   // 5 → 10 min
pub const SNIPE_BPS_1: u64 = 150;      // 1.5%
pub const SNIPE_BPS_2: u64 = 250;      // 2.5%
pub const SNIPE_BPS_3: u64 = 500;      // 5%

/// ── Graduation fee (2.5% of pool SOL) ─────────────────
/// Split: 60% stays as LP in Meteora, 20% protocol, 8% airdrop, 12% holder reserve
pub const GRAD_FEE_BPS: u64 = 250;          // 2.5% total
pub const GRAD_LP_BPS: u64 = 6000;          // 60% of fee
pub const GRAD_PROTOCOL_BPS: u64 = 2000;    // 20% of fee
pub const GRAD_AIRDROP_BPS: u64 = 800;      // 8% of fee
pub const GRAD_HOLDER_BPS: u64 = 1200;      // 12% of fee

/// Anti-vamp: MC threshold for protection activation (in USD cents)
/// $100,000 = 10_000_000 cents
pub const MC_PROTECTION_THRESHOLD_CENTS: u64 = 10_000_000;

/// Identity lock cooldown: 24 hours in seconds
pub const IDENTITY_COOLDOWN_SECS: i64 = 86_400;

/// Source lock signature TTL: 5 minutes
pub const SIGNATURE_TTL_SECS: i64 = 300;
