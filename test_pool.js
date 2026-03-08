const {Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram} = require("@solana/web3.js");
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, mintTo, getOrCreateAssociatedTokenAccount, getAccount} = require("@solana/spl-token");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");
const DISC = {
  add_liquidity: Buffer.from("b59d59438fb63448", "hex"),
  swap: Buffer.from("f8c69e91e17587c8", "hex"),
};

function associatedTokenAddress(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/home/codespace/.config/solana/id.json"))));
  console.log("Wallet:", keypair.publicKey.toBase58());
  console.log("Balance:", (await conn.getBalance(keypair.publicKey)) / 1e9, "SOL");

  const [curveConfig] = PublicKey.findProgramAddressSync([Buffer.from("CurveConfiguration")], PROGRAM_ID);
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from("global")], PROGRAM_ID);

  console.log("\n=== CREATING TOKEN ===");
  const mint = await createMint(conn, keypair, keypair.publicKey, null, 9);
  console.log("Mint:", mint.toBase58());

  const userAta = await getOrCreateAssociatedTokenAccount(conn, keypair, mint, keypair.publicKey);
  console.log("User ATA:", userAta.address.toBase58());

  const BONDING = BigInt(650_000_000) * BigInt(1_000_000_000);
  await mintTo(conn, keypair, mint, userAta.address, keypair.publicKey, BONDING);
  console.log("Minted 650M tokens");

  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_pool"), mint.toBuffer()], PROGRAM_ID
  );
  const poolAta = associatedTokenAddress(mint, globalAccount);
  const [liqProvider] = PublicKey.findProgramAddressSync(
    [Buffer.from("LiqudityProvider"), pool.toBuffer(), keypair.publicKey.toBuffer()], PROGRAM_ID
  );
  console.log("Pool:", pool.toBase58());

  console.log("\n=== CREATING POOL ===");
  const amountOne = Buffer.alloc(8);
  amountOne.writeBigUInt64LE(BONDING, 0);
  const amountTwo = Buffer.alloc(8);
  amountTwo.writeBigUInt64LE(BigInt(0), 0);

  const addLiqIx = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: liqProvider, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: userAta.address, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.add_liquidity, amountOne, amountTwo]),
  });

  const addTx = new Transaction().add(addLiqIx);
  addTx.feePayer = keypair.publicKey;
  addTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  addTx.sign(keypair);

  let sim = await conn.simulateTransaction(addTx);
  console.log("Simulate add_liquidity:");
  sim.value.logs.forEach(l => console.log(" ", l));
  if (sim.value.err) {
    console.log("ERROR:", JSON.stringify(sim.value.err));
    return;
  }

  const addSig = await conn.sendRawTransaction(addTx.serialize());
  await conn.confirmTransaction(addSig);
  console.log("Add liquidity TX:", addSig);

  const poolInfo = await conn.getAccountInfo(pool);
  console.log("Pool exists:", !!poolInfo, "Size:", poolInfo ? poolInfo.data.length : 0);

  console.log("\n=== BUY 0.1 SOL ===");
  const buyAmount = Buffer.alloc(8);
  buyAmount.writeBigUInt64LE(BigInt(100_000_000), 0);
  const buyStyle = Buffer.alloc(8);
  buyStyle.writeBigUInt64LE(BigInt(0), 0);

  const buyIx = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: userAta.address, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.swap, buyAmount, buyStyle]),
  });

  const buyTx = new Transaction().add(buyIx);
  buyTx.feePayer = keypair.publicKey;
  buyTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  buyTx.sign(keypair);

  sim = await conn.simulateTransaction(buyTx);
  console.log("Simulate buy:");
  sim.value.logs.forEach(l => console.log(" ", l));
  if (sim.value.err) {
    console.log("ERROR:", JSON.stringify(sim.value.err));
    return;
  }

  const buySig = await conn.sendRawTransaction(buyTx.serialize());
  await conn.confirmTransaction(buySig);
  console.log("Buy TX:", buySig);

  const tokenBal = await getAccount(conn, userAta.address);
  console.log("Token balance:", Number(tokenBal.amount) / 1e9);
  console.log("SOL balance:", (await conn.getBalance(keypair.publicKey)) / 1e9);

  console.log("\n=== SUCCESS ===");
  console.log("Explorer: https://explorer.solana.com/address/" + PROGRAM_ID.toBase58() + "?cluster=devnet");
}

main().catch(console.error);