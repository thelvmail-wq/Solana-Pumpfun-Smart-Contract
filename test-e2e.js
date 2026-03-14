const {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, SYSVAR_RENT_PUBKEY, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  createInitializeMint2Instruction, createMintToInstruction,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} = require("@solana/spl-token");
const fs = require("fs");
const crypto = require("crypto");

const PROGRAM_ID = new PublicKey("BQ51fq1UavsR8typUWE4y4EsYN7tSF1cVfU27wVrHP6C");
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./id.json", "utf-8"))));

function disc(name) {
  return crypto.createHash("sha256").update("global:" + name).digest().slice(0, 8);
}
function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}
async function sendTx(ixs, signers, label) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log("OK " + label + ": " + sig);
  return sig;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const [dexConfig] = pda([Buffer.from("CurveConfiguration")]);
const [globalPda] = pda([Buffer.from("global")]);

async function main() {
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", (await conn.getBalance(wallet.publicKey)) / 1e9, "SOL");

  console.log("\n-- STEP 1: Create Mint --");
  const mint = Keypair.generate();
  const mintLam = await getMinimumBalanceForRentExemptMint(conn);
  const userAta = await getAssociatedTokenAddress(mint.publicKey, wallet.publicKey);
  const poolAta = await getAssociatedTokenAddress(mint.publicKey, globalPda, true);

  await sendTx([
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports: mintLam, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 6, wallet.publicKey, null),
    createAssociatedTokenAccountInstruction(wallet.publicKey, userAta, wallet.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, userAta, wallet.publicKey, BigInt(1_000_000_000_000_000)),
  ], [wallet, mint], "Create mint + user ATA + mint 1B tokens");
  console.log("Mint:", mint.publicKey.toBase58());

  console.log("\n-- STEP 2: Add Liquidity --");
  const [poolPda] = pda([Buffer.from("liquidity_pool"), mint.publicKey.toBuffer()]);
  const [lpAccount] = pda([Buffer.from("LiqudityProvider"), poolPda.toBuffer(), wallet.publicKey.toBuffer()]);

  await sendTx([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: globalPda, isSigner: false, isWritable: true },
      { pubkey: lpAccount, isSigner: false, isWritable: true },
      { pubkey: mint.publicKey, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("add_liquidity"),
      Buffer.from(new BigUint64Array([BigInt(650_000_000_000_000)]).buffer),
      Buffer.from(new BigUint64Array([BigInt(750_000_000)]).buffer),
    ]),
  })], [wallet], "Add liquidity");

  console.log("\n-- STEP 3: Buy to Graduation --");
  console.log("Waiting 320s for anti-snipe to fully expire...");
  await sleep(320_000);

  // Buy in small 0.3 SOL chunks to avoid any residual max wallet issues
  let totalBought = 0;
  const TARGET = 2_500_000_000; // 2.5 SOL to safely pass 2 SOL threshold
  const CHUNK = 300_000_000;    // 0.3 SOL per buy

  while (totalBought < TARGET) {
    const amt = Math.min(CHUNK, TARGET - totalBought + 100_000_000);
    const swapData = Buffer.concat([
      disc("swap"),
      Buffer.from(new BigUint64Array([BigInt(amt)]).buffer),
      Buffer.from(new BigUint64Array([BigInt(0)]).buffer),
    ]);
    try {
      await sendTx([new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: dexConfig, isSigner: false, isWritable: true },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: globalPda, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: true },
          { pubkey: poolAta, isSigner: false, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: swapData,
      })], [wallet], "Buy " + (amt/1e9) + " SOL (total: " + ((totalBought+amt)/1e9) + ")");
      totalBought += amt;
    } catch (e) {
      const msg = e.message || "";
      if (msg.includes("AlreadyGraduated") || msg.includes("0x1772")) {
        console.log("Pool already graduated!");
        break;
      }
      if (msg.includes("MaxWallet") || msg.includes("0x177a")) {
        console.log("Max wallet hit, trying smaller...");
        await sleep(2000);
        continue;
      }
      console.log("Buy error:", msg.slice(0, 200));
      break;
    }
    await sleep(1500);
  }

  console.log("\n-- STEP 4: Check Graduation --");
  const poolData = await conn.getAccountInfo(poolPda);
  const graduated = poolData.data[105] === 1;
  const totalRaised = Number(poolData.data.readBigUInt64LE(106)) / 1e9;
  console.log("Graduated:", graduated, "| SOL raised:", totalRaised);
  if (!graduated) { console.log("FAIL: not graduated"); return; }

  console.log("\n-- STEP 5: Prepare Migration --");
  const [escrowPda] = pda([Buffer.from("migration_escrow"), mint.publicKey.toBuffer()]);
  const escrowAta = await getAssociatedTokenAddress(mint.publicKey, escrowPda, true);
  try {
    await sendTx([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: dexConfig, isSigner: false, isWritable: false },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: poolAta, isSigner: false, isWritable: true },
        { pubkey: escrowAta, isSigner: false, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc("prepare_migration"),
    })], [wallet], "Prepare migration");
    console.log("Escrow SOL:", (await conn.getBalance(escrowPda)) / 1e9);
  } catch (e) { console.log("FAIL prepare_migration:", e.message?.slice(0, 300)); }

  console.log("\n-- STEP 6: Release Escrow --");
  try {
    await sendTx([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: dexConfig, isSigner: false, isWritable: false },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: escrowAta, isSigner: false, isWritable: true },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc("release_escrow"),
    })], [wallet], "Release escrow");
    console.log("Final balance:", (await conn.getBalance(wallet.publicKey)) / 1e9, "SOL");
  } catch (e) { console.log("FAIL release_escrow:", e.message?.slice(0, 300)); }

  console.log("\n== DONE ==");
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Mint:", mint.publicKey.toBase58());
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
