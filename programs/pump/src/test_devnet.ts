import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
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

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");

const DISC = {
  initialize:       Buffer.from("afaf6d1f0d989bed", "hex"),
  add_liquidity:    Buffer.from("b59d59438fb63448", "hex"),
  swap:             Buffer.from("f8c69e91e17587c8", "hex"),
};

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  console.log("Wallet:", wallet.publicKey.toBase58());
  const bal = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", bal / LAMPORTS_PER_SOL, "SOL");

  const [curveConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("CurveConfiguration")], PROGRAM_ID
  );
  const [globalAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")], PROGRAM_ID
  );

  console.log("\nCurveConfig:", curveConfig.toBase58());
  console.log("Global:", globalAccount.toBase58());

  // === 1. INITIALIZE ===
  const curveConfigInfo = await connection.getAccountInfo(curveConfig);
  if (!curveConfigInfo) {
    console.log("\n=== INITIALIZING ===");
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeDoubleLE(1.5, 0);
    const data = Buffer.concat([
      DISC.initialize,
      feeBuffer,
      wallet.publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: curveConfig, isSigner: false, isWritable: true },
        { pubkey: globalAccount, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data,
    });
    try {
      const sig = await provider.sendAndConfirm(new Transaction().add(ix));
      console.log("Initialize tx:", sig);
    } catch (e: any) {
      console.log("Initialize error:", e.message);
      if (e.logs) e.logs.forEach((l: string) => console.log("  ", l));
    }
  } else {
    console.log("\nAlready initialized");
  }

  // === 2. CREATE TEST TOKEN ===
  console.log("\n=== CREATING TOKEN ===");
  const mint = await createMint(connection, wallet.payer, wallet.publicKey, null, 9);
  console.log("Mint:", mint.toBase58());

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, wallet.payer, mint, wallet.publicKey
  );
  console.log("User ATA:", userTokenAccount.address.toBase58());

  const BONDING_AMOUNT = BigInt(650_000_000) * BigInt(1_000_000_000);
  await mintTo(connection, wallet.payer, mint, userTokenAccount.address, wallet.publicKey, BONDING_AMOUNT);
  console.log("Minted 650M tokens");

  // === 3. DERIVE POOL PDAs ===
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_pool"), mint.toBuffer()], PROGRAM_ID
  );
  const poolTokenAccount = anchor.utils.token.associatedAddress({ mint, owner: globalAccount });
  const [liquidityProvider] = PublicKey.findProgramAddressSync(
    [Buffer.from("LiqudityProvider"), pool.toBuffer(), wallet.publicKey.toBuffer()], PROGRAM_ID
  );
  console.log("Pool:", pool.toBase58());

  // === 4. ADD LIQUIDITY ===
  console.log("\n=== CREATING POOL ===");
  const amountOne = Buffer.alloc(8);
  amountOne.writeBigUInt64LE(BONDING_AMOUNT, 0);
  const amountTwo = Buffer.alloc(8);
  amountTwo.writeBigUInt64LE(BigInt(0), 0);

  const addLiqIx = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: liquidityProvider, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount.address, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.add_liquidity, amountOne, amountTwo]),
  });

  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(addLiqIx));
    console.log("Add liquidity tx:", sig);
  } catch (e: any) {
    console.log("Add liquidity error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("  ", l));
  }

  // === 5. BUY 0.1 SOL ===
  console.log("\n=== TEST BUY (0.1 SOL) ===");
  const buyAmount = Buffer.alloc(8);
  buyAmount.writeBigUInt64LE(BigInt(Math.floor(0.1 * LAMPORTS_PER_SOL)), 0);
  const buyStyle = Buffer.alloc(8);
  buyStyle.writeBigUInt64LE(BigInt(0), 0);

  const buyIx = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount.address, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.swap, buyAmount, buyStyle]),
  });

  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(buyIx));
    console.log("Buy tx:", sig);
    const acct = await getAccount(connection, userTokenAccount.address);
    console.log("Token balance:", Number(acct.amount) / 1e9);
  } catch (e: any) {
    console.log("Buy error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("  ", l));
  }

  // === 6. SELL 1000 tokens ===
  console.log("\n=== TEST SELL (1000 tokens) ===");
  const sellAmount = Buffer.alloc(8);
  sellAmount.writeBigUInt64LE(BigInt(1000) * BigInt(1_000_000_000), 0);
  const sellStyle = Buffer.alloc(8);
  sellStyle.writeBigUInt64LE(BigInt(1), 0);

  const sellIx = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount.address, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.swap, sellAmount, sellStyle]),
  });

  try {
    const sig = await provider.sendAndConfirm(new Transaction().add(sellIx));
    console.log("Sell tx:", sig);
    const solBal = await connection.getBalance(wallet.publicKey);
    console.log("SOL balance:", solBal / LAMPORTS_PER_SOL);
  } catch (e: any) {
    console.log("Sell error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("  ", l));
  }

  console.log("\n=== DONE ===");
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Explorer: https://explorer.solana.com/address/" + PROGRAM_ID.toBase58() + "?cluster=devnet");
}

main().catch(console.error);