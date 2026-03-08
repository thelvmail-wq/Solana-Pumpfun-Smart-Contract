import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");

const DISC = {
  initialize:              Buffer.from("afaf6d1f0d989bed", "hex"),
  add_liquidity:           Buffer.from("b59d59438fb63448", "hex"),
  swap:                    Buffer.from("f8c69e91e17587c8", "hex"),
  create_token_registry:   Buffer.from("ec4062c2843c7324", "hex"),
  claim_locks:             Buffer.from("50ac2a7b3fc26165", "hex"),
};

// ─── HASHING ──────────────────────────────────────────────────────────────────

function hashTicker(ticker: string): Buffer {
  return createHash("sha256").update(ticker.trim().toUpperCase()).digest();
}
function hashIdentity(identity: string): Buffer {
  const n = identity.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return createHash("sha256").update(n).digest();
}
function hashImage(imageBytes: Buffer): Buffer {
  return createHash("sha256").update(imageBytes).digest();
}
function encodeTicker(ticker: string): Buffer {
  const buf = Buffer.alloc(16, 0);
  Buffer.from(ticker.trim().toUpperCase().slice(0, 16)).copy(buf);
  return buf;
}

// ─── PDA DERIVATION ───────────────────────────────────────────────────────────

function deriveTokenRegistry(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_registry"), mint.toBuffer()], PROGRAM_ID)[0];
}
function deriveTickerLock(tickerHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ticker_lock"), tickerHash], PROGRAM_ID)[0];
}
function deriveImageLock(imageHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("image_lock"), imageHash], PROGRAM_ID)[0];
}
function deriveIdentityLock(identityHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity_lock"), identityHash], PROGRAM_ID)[0];
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL, "SOL\n");

  const [curveConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("CurveConfiguration")], PROGRAM_ID);
  const [globalAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")], PROGRAM_ID);

  // ── 1. INITIALIZE ─────────────────────────────────────────────────────────
  if (!await connection.getAccountInfo(curveConfig)) {
    console.log("=== INITIALIZING ===");
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeDoubleLE(1.5, 0);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: curveConfig,             isSigner: false, isWritable: true  },
        { pubkey: globalAccount,           isSigner: false, isWritable: true  },
        { pubkey: wallet.publicKey,        isSigner: true,  isWritable: true  },
        { pubkey: SYSVAR_RENT_PUBKEY,      isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: Buffer.concat([DISC.initialize, feeBuffer,
        wallet.publicKey.toBuffer(), wallet.publicKey.toBuffer()]),
    });
    try {
      const sig = await provider.sendAndConfirm(new Transaction().add(ix));
      console.log("Initialize tx:", sig);
    } catch (e: any) {
      console.log("Initialize error:", e.message);
      if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
    }
  } else {
    console.log("Already initialized");
  }

  // ── 2. CREATE TOKEN ────────────────────────────────────────────────────────
  console.log("\n=== CREATING TOKEN ===");
  const mint = await createMint(connection, wallet.payer, wallet.publicKey, null, 9);
  console.log("Mint:", mint.toBase58());

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, wallet.payer, mint, wallet.publicKey);

  const BONDING_AMOUNT = BigInt(650_000_000) * BigInt(1_000_000_000);
  await mintTo(connection, wallet.payer, mint, userTokenAccount.address, wallet.publicKey, BONDING_AMOUNT);
  console.log("Minted 650M tokens");

  // ── 3. REGISTER TOKEN — two instructions ──────────────────────────────────
  console.log("\n=== REGISTERING TOKEN (anti-vamp) ===");

  const TICKER    = "TEST";
  const IDENTITY  = "https://x.com/summitmoon_sol";
  const IMAGE_BYTES = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c6260000000000200012721e25600" +
    "00000049454e44ae426082", "hex");

  const tickerHash   = hashTicker(TICKER);
  const imageHash    = hashImage(IMAGE_BYTES);
  const identityHash = hashIdentity(IDENTITY);
  const tickerRaw    = encodeTicker(TICKER);

  const tokenRegistry = deriveTokenRegistry(mint);
  const tickerLock    = deriveTickerLock(tickerHash);
  const imageLock     = deriveImageLock(imageHash);
  const identityLock  = deriveIdentityLock(identityHash);

  console.log("Registry PDA:", tokenRegistry.toBase58());
  console.log("Ticker lock: ", tickerLock.toBase58());
  console.log("Ticker available:", !(await connection.getAccountInfo(tickerLock)) ? "✅" : "⚠️ already taken");

  // Step 1: create_token_registry
  // Accounts: token_registry, mint, creator, system_program
  const createRegistryIx = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry,           isSigner: false, isWritable: true  },
      { pubkey: mint,                    isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,        isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([
      DISC.create_token_registry,
      tickerHash, imageHash, identityHash, tickerRaw,
    ]),
  });

  // Step 2: claim_locks
  // Accounts: token_registry, ticker_lock, image_lock, identity_lock, creator, system_program
  const claimLocksIx = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry,           isSigner: false, isWritable: false },
      { pubkey: tickerLock,              isSigner: false, isWritable: true  },
      { pubkey: imageLock,               isSigner: false, isWritable: true  },
      { pubkey: identityLock,            isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,        isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([
      DISC.claim_locks,
      tickerHash, imageHash, identityHash,
    ]),
  });

  try {
    // Send both in same transaction — atomic: both succeed or both fail
    const sig = await provider.sendAndConfirm(
      new Transaction().add(createRegistryIx).add(claimLocksIx));
    console.log("✅ Registered:", sig);
    console.log("   https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
  } catch (e: any) {
    console.log("❌ Register error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  // ── 4. FIRST-DEPLOYER-WINS TEST ────────────────────────────────────────────
  console.log("\n=== FIRST-DEPLOYER-WINS TEST (must fail) ===");
  const mint2 = await createMint(connection, wallet.payer, wallet.publicKey, null, 9);
  const tokenRegistry2 = deriveTokenRegistry(mint2);

  const createRegistry2Ix = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry2,          isSigner: false, isWritable: true  },
      { pubkey: mint2,                   isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,        isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.create_token_registry, tickerHash, imageHash, identityHash, tickerRaw]),
  });
  const claimLocks2Ix = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry2,          isSigner: false, isWritable: false },
      { pubkey: tickerLock,              isSigner: false, isWritable: true  }, // same PDAs — must fail
      { pubkey: imageLock,               isSigner: false, isWritable: true  },
      { pubkey: identityLock,            isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,        isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.claim_locks, tickerHash, imageHash, identityHash]),
  });
  try {
    await provider.sendAndConfirm(new Transaction().add(createRegistry2Ix).add(claimLocks2Ix));
    console.log("❌ FAIL: should have been blocked");
  } catch (e: any) {
    console.log("✅ Correctly blocked:", e.message.slice(0, 80));
  }

  // ── 5. ADD LIQUIDITY ───────────────────────────────────────────────────────
  console.log("\n=== CREATING POOL ===");
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_pool"), mint.toBuffer()], PROGRAM_ID);
  const poolTokenAccount = anchor.utils.token.associatedAddress({ mint, owner: globalAccount });
  const [liquidityProvider] = PublicKey.findProgramAddressSync(
    [Buffer.from("LiqudityProvider"), pool.toBuffer(), wallet.publicKey.toBuffer()], PROGRAM_ID);
  console.log("Pool:", pool.toBase58());

  const amountOne = Buffer.alloc(8);
  amountOne.writeBigUInt64LE(BONDING_AMOUNT, 0);
  const amountTwo = Buffer.alloc(8);
  amountTwo.writeBigUInt64LE(BigInt(0), 0);

  const addLiqIx = new TransactionInstruction({
    keys: [
      { pubkey: pool,                        isSigner: false, isWritable: true  },
      { pubkey: globalAccount,               isSigner: false, isWritable: true  },
      { pubkey: liquidityProvider,           isSigner: false, isWritable: true  },
      { pubkey: mint,                        isSigner: false, isWritable: true  },
      { pubkey: poolTokenAccount,            isSigner: false, isWritable: true  },
      { pubkey: userTokenAccount.address,    isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,            isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.add_liquidity, amountOne, amountTwo]),
  });
  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(addLiqIx));
    console.log("✅ Pool created:", sig);
  } catch (e: any) {
    console.log("❌ Add liquidity error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  // ── 6. BUY — small amount to stay under anti-snipe limit ──────────────────
  console.log("\n=== BUY (0.001 SOL) ===");
  // Anti-snipe: within 30s of launch, max wallet = 1% of 650M = 6.5M tokens
  // 0.001 SOL buys well under that limit
  const buyAmount = Buffer.alloc(8);
  buyAmount.writeBigUInt64LE(BigInt(Math.floor(0.001 * LAMPORTS_PER_SOL)), 0);
  const buyStyle = Buffer.alloc(8);
  buyStyle.writeBigUInt64LE(BigInt(0), 0);

  const buyIx = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig,                 isSigner: false, isWritable: true  },
      { pubkey: pool,                        isSigner: false, isWritable: true  },
      { pubkey: globalAccount,               isSigner: false, isWritable: true  },
      { pubkey: mint,                        isSigner: false, isWritable: true  },
      { pubkey: poolTokenAccount,            isSigner: false, isWritable: true  },
      { pubkey: userTokenAccount.address,    isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,            isSigner: true,  isWritable: true  },
      { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.swap, buyAmount, buyStyle]),
  });
  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(buyIx));
    console.log("✅ Buy tx:", sig);
    const acct = await getAccount(connection, userTokenAccount.address);
    console.log("   Token balance:", Number(acct.amount) / 1e9);
  } catch (e: any) {
    console.log("❌ Buy error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  // ── 7. SELL ───────────────────────────────────────────────────────────────
  console.log("\n=== SELL (100 tokens) ===");
  const sellAmount = Buffer.alloc(8);
  sellAmount.writeBigUInt64LE(BigInt(100) * BigInt(1_000_000_000), 0);
  const sellStyle = Buffer.alloc(8);
  sellStyle.writeBigUInt64LE(BigInt(1), 0);

  const sellIx = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig,                 isSigner: false, isWritable: true  },
      { pubkey: pool,                        isSigner: false, isWritable: true  },
      { pubkey: globalAccount,               isSigner: false, isWritable: true  },
      { pubkey: mint,                        isSigner: false, isWritable: true  },
      { pubkey: poolTokenAccount,            isSigner: false, isWritable: true  },
      { pubkey: userTokenAccount.address,    isSigner: false, isWritable: true  },
      { pubkey: wallet.publicKey,            isSigner: true,  isWritable: true  },
      { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.swap, sellAmount, sellStyle]),
  });
  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(sellIx));
    console.log("✅ Sell tx:", sig);
    console.log("   SOL balance:", (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL);
  } catch (e: any) {
    console.log("❌ Sell error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  console.log("\n=== DONE ===");
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Explorer: https://explorer.solana.com/address/" + PROGRAM_ID.toBase58() + "?cluster=devnet");
}

main().catch(console.error);