import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  Connection,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");

// Anchor discriminator for register_token instruction
// sha256("global:register_token")[0..8]
const DISC_REGISTER_TOKEN = Buffer.from("209224f050b72454", "hex");
// ─── SEED PREFIXES (must match registry.rs exactly) ──────────────────────────
const TOKEN_REGISTRY_SEED  = "token_registry";
const TICKER_LOCK_SEED     = "ticker_lock";
const IMAGE_LOCK_SEED      = "image_lock";
const IDENTITY_LOCK_SEED   = "identity_lock";

// ─── HASHING HELPERS ─────────────────────────────────────────────────────────

/**
 * Hash a ticker string consistently.
 * Always normalizes: trim whitespace, uppercase.
 * e.g. "emi" → "EMI" → sha256 → [u8; 32]
 */
export function hashTicker(ticker: string): Buffer {
  const normalized = ticker.trim().toUpperCase();
  return createHash("sha256").update(normalized).digest();
}

/**
 * Hash an identity (Twitter URL, domain, article URL) consistently.
 * Normalizes: lowercase, strip trailing slash, strip https://, strip www.
 * e.g. "https://x.com/ElonMusk" → "x.com/elonmusk" → sha256 → [u8; 32]
 */
export function hashIdentity(identity: string): Buffer {
  const normalized = identity
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return createHash("sha256").update(normalized).digest();
}

/**
 * Hash an image consistently.
 * Pass the raw image bytes (Buffer/Uint8Array).
 * The off-chain client should fetch the image and pass the bytes here.
 * For a simple SHA-256 hash (not perceptual) — good enough for exact duplicates.
 * If you want perceptual hashing (catches resized/recolored copies), use
 * the `sharp` + `blockhash` libraries instead and swap this function out.
 */
export function hashImage(imageBytes: Buffer): Buffer {
  return createHash("sha256").update(imageBytes).digest();
}

/**
 * Encode a ticker string into a fixed [u8; 16] array (null-padded).
 * This is the raw ticker stored on-chain for display purposes.
 */
export function encodeTicker(ticker: string): Buffer {
  const normalized = ticker.trim().toUpperCase();
  const buf = Buffer.alloc(16, 0);
  Buffer.from(normalized.slice(0, 16)).copy(buf);
  return buf;
}

// ─── PDA DERIVATION ──────────────────────────────────────────────────────────

export function deriveTokenRegistry(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_REGISTRY_SEED), mint.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveTickerLock(tickerHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TICKER_LOCK_SEED), tickerHash],
    PROGRAM_ID
  );
}

export function deriveImageLock(imageHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(IMAGE_LOCK_SEED), imageHash],
    PROGRAM_ID
  );
}

export function deriveIdentityLock(identityHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(IDENTITY_LOCK_SEED), identityHash],
    PROGRAM_ID
  );
}

// ─── PRE-FLIGHT CHECK ─────────────────────────────────────────────────────────

/**
 * Check on-chain if a ticker is already taken BEFORE sending the tx.
 * Returns the PublicKey of the existing ticker lock if taken, null if free.
 * Use this to show the "ticker taken" UI state before the user hits deploy.
 */
export async function checkTickerAvailable(
  connection: Connection,
  ticker: string
): Promise<{ available: boolean; lockedBy?: PublicKey }> {
  const tickerHash = hashTicker(ticker);
  const [tickerLockPda] = deriveTickerLock(tickerHash);
  const info = await connection.getAccountInfo(tickerLockPda);
  if (!info) return { available: true };
  // Account exists → ticker already deployed by someone
  // Parse the registry pubkey from the lock account data (offset 8 = after discriminator)
  const registryPubkey = new PublicKey(info.data.slice(8, 40));
  return { available: false, lockedBy: registryPubkey };
}

// ─── BUILD INSTRUCTION ────────────────────────────────────────────────────────

export interface RegisterTokenParams {
  mint: PublicKey;
  creator: PublicKey;
  ticker: string;           // e.g. "EMI" — will be normalized + hashed
  identity: string;         // Twitter URL, domain, or article URL — hashed
  imageBytes: Buffer;       // Raw image bytes — hashed
}

export function buildRegisterTokenIx(params: RegisterTokenParams): {
  ix: TransactionInstruction;
  tickerHash: Buffer;
  imageHash: Buffer;
  identityHash: Buffer;
  pdas: {
    tokenRegistry: PublicKey;
    tickerLock: PublicKey;
    imageLock: PublicKey;
    identityLock: PublicKey;
  };
} {
  const { mint, creator, ticker, identity, imageBytes } = params;

  const tickerHash   = hashTicker(ticker);
  const imageHash    = hashImage(imageBytes);
  const identityHash = hashIdentity(identity);
  const tickerRaw    = encodeTicker(ticker);

  const [tokenRegistry] = deriveTokenRegistry(mint);
  const [tickerLock]    = deriveTickerLock(tickerHash);
  const [imageLock]     = deriveImageLock(imageHash);
  const [identityLock]  = deriveIdentityLock(identityHash);

  // Instruction data: discriminator (8) + ticker_hash (32) + image_hash (32) + identity_hash (32) + ticker_raw (16)
  const data = Buffer.concat([
    DISC_REGISTER_TOKEN,
    tickerHash,
    imageHash,
    identityHash,
    tickerRaw,
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: tokenRegistry, isSigner: false, isWritable: true },
      { pubkey: tickerLock,    isSigner: false, isWritable: true },
      { pubkey: imageLock,     isSigner: false, isWritable: true },
      { pubkey: identityLock,  isSigner: false, isWritable: true },
      { pubkey: mint,          isSigner: false, isWritable: true },
      { pubkey: creator,       isSigner: true,  isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  return {
    ix,
    tickerHash,
    imageHash,
    identityHash,
    pdas: { tokenRegistry, tickerLock, imageLock, identityLock },
  };
}

// ─── USAGE EXAMPLE ────────────────────────────────────────────────────────────
//
// import { checkTickerAvailable, buildRegisterTokenIx } from "./register_token_client";
// import * as fs from "fs";
//
// // 1. Check if ticker is free before deploying
// const { available, lockedBy } = await checkTickerAvailable(connection, "EMI");
// if (!available) {
//   console.log("Ticker taken, locked by registry:", lockedBy?.toBase58());
//   return;
// }
//
// // 2. Load image bytes (fetch from URL or read from disk)
// const imageBytes = fs.readFileSync("./token_image.png");
//
// // 3. Build the instruction
// const { ix, pdas } = buildRegisterTokenIx({
//   mint: mintKeypair.publicKey,
//   creator: wallet.publicKey,
//   ticker: "EMI",
//   identity: "https://x.com/elonmusk",   // or article URL, domain, etc.
//   imageBytes,
// });
//
// // 4. Send it (typically bundled with your add_liquidity ix in the same tx)
// const sig = await provider.sendAndConfirm(new Transaction().add(ix));
// console.log("Registered:", sig);
// console.log("Registry PDA:", pdas.tokenRegistry.toBase58());