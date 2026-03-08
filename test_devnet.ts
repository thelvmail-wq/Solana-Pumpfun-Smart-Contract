import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
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

function discriminator(name: string) {
  return Buffer.from(anchor.utils.sha256.hash(name)).slice(0, 8);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as any;
  const payer = wallet.payer ?? wallet;

  const connection = provider.connection;

  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log(
    "Balance:",
    (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL,
    "SOL"
  );

  const programId = PROGRAM_ID;

  // ===== PDAs =====

  const [curveConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("CurveConfiguration")],
    programId
  );

  const [globalAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    programId
  );

  console.log("\n=== PDAs ===");
  console.log("CurveConfig:", curveConfig.toBase58());
  console.log("Global:", globalAccount.toBase58());

  // ===== INITIALIZE =====

  const curveConfigInfo = await connection.getAccountInfo(curveConfig);

  if (!curveConfigInfo) {
    console.log("\n=== INITIALIZING PROGRAM ===");

    const fee = 1.5;
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeDoubleLE(fee, 0);

    const data = Buffer.concat([
      discriminator("global:initialize"),
      feeBuffer,
      wallet.publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
    ]);

    const initIx = new TransactionInstruction({
      keys: [
        { pubkey: curveConfig, isSigner: false, isWritable: true },
        { pubkey: globalAccount, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });

    const tx = new Transaction().add(initIx);

    try {
      const sig = await provider.sendAndConfirm(tx);
      console.log("Initialize tx:", sig);
    } catch (e: any) {
      console.log("Initialize error:", e.message);
      if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
    }
  } else {
    console.log("\nProgram already initialized");
  }

  // ===== CREATE TEST TOKEN =====

  console.log("\n=== CREATING TEST TOKEN ===");

  const mintKeypair = Keypair.generate();

  const mint = await createMint(
    connection,
    payer,
    wallet.publicKey,
    null,
    9,
    mintKeypair
  );

  console.log("Mint:", mint.toBase58());

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    wallet.publicKey
  );

  console.log("User token account:", userTokenAccount.address.toBase58());

  const TOTAL_SUPPLY = 1_000_000_000n * 1_000_000_000n;
  const BONDING_AMOUNT = (TOTAL_SUPPLY * 65n) / 100n;

  await mintTo(
    connection,
    payer,
    mint,
    userTokenAccount.address,
    wallet.publicKey,
    BONDING_AMOUNT
  );

  console.log("Minted tokens:", Number(BONDING_AMOUNT) / 1e9);

  // ===== POOL PDAs =====

  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_pool"), mint.toBuffer()],
    programId
  );

  const poolTokenAccount = await anchor.utils.token.associatedAddress({
    mint,
    owner: globalAccount,
  });

  const [liquidityProvider] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("LiquidityProvider"),
      pool.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    programId
  );

  console.log("\n=== POOL PDAs ===");
  console.log("Pool:", pool.toBase58());
  console.log("Pool token account:", poolTokenAccount.toBase58());
  console.log("Liquidity provider:", liquidityProvider.toBase58());

  // ===== ADD LIQUIDITY =====

  console.log("\n=== CREATING POOL ===");

  const amountTokens = BONDING_AMOUNT;
  const amountSol = 0;

  const amountOneBuffer = Buffer.alloc(8);
  amountOneBuffer.writeBigUInt64LE(amountTokens, 0);

  const amountTwoBuffer = Buffer.alloc(8);
  amountTwoBuffer.writeBigUInt64LE(BigInt(amountSol), 0);

  const addLiqData = Buffer.concat([
    discriminator("global:add_liquidity"),
    amountOneBuffer,
    amountTwoBuffer,
  ]);

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
    programId,
    data: addLiqData,
  });

  try {
    const sig = await provider.sendAndConfirm(
      new Transaction().add(addLiqIx)
    );
    console.log("Add liquidity tx:", sig);
  } catch (e: any) {
    console.log("Add liquidity error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  // ===== BUY TEST =====

  console.log("\n=== TEST BUY (0.1 SOL) ===");

  const swapAmount = BigInt(0.1 * LAMPORTS_PER_SOL);
  const swapStyle = 0n;

  const swapAmountBuffer = Buffer.alloc(8);
  swapAmountBuffer.writeBigUInt64LE(swapAmount, 0);

  const swapStyleBuffer = Buffer.alloc(8);
  swapStyleBuffer.writeBigUInt64LE(swapStyle, 0);

  const swapData = Buffer.concat([
    discriminator("global:swap"),
    swapAmountBuffer,
    swapStyleBuffer,
  ]);

  const swapIx = new TransactionInstruction({
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
    programId,
    data: swapData,
  });

  try {
    const sig = await provider.sendAndConfirm(
      new Transaction().add(swapIx)
    );

    console.log("Swap tx:", sig);

    const tokenAcct = await getAccount(connection, userTokenAccount.address);
    console.log("Token balance:", Number(tokenAcct.amount) / 1e9);
  } catch (e: any) {
    console.log("Swap error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log(" ", l));
  }

  console.log("\n=== DONE ===");
  console.log("Program ID:", programId.toBase58());
}

main().catch(console.error);