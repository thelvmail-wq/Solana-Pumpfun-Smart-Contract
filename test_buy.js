const {Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram} = require("@solana/web3.js");
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount} = require("@solana/spl-token");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");
const RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const mint = new PublicKey("BASdq6qArhxLhuHxJWyvdXeh7JmbeFn5MPYciy6ENdS4");

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/home/codespace/.config/solana/id.json"))));

  const [curveConfig] = PublicKey.findProgramAddressSync([Buffer.from("CurveConfiguration")], PROGRAM_ID);
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from("global")], PROGRAM_ID);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("liquidity_pool"), mint.toBuffer()], PROGRAM_ID);

  const poolAta = PublicKey.findProgramAddressSync(
    [globalAccount.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  const userAta = PublicKey.findProgramAddressSync(
    [keypair.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  console.log("Wallet:", keypair.publicKey.toBase58());
  console.log("Pool:", pool.toBase58());
  console.log("Buying 0.1 SOL worth of tokens...");

  const disc = Buffer.from("f8c69e91e17587c8", "hex");
  const buyAmount = Buffer.alloc(8);
  buyAmount.writeBigUInt64LE(BigInt(100_000_000), 0);
  const buyStyle = Buffer.alloc(8);
  buyStyle.writeBigUInt64LE(BigInt(0), 0);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([disc, buyAmount, buyStyle]),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(keypair);

  const sim = await conn.simulateTransaction(tx);
  console.log("Simulation:");
  sim.value.logs.forEach(l => console.log(" ", l));

  if (sim.value.err) {
    console.log("ERROR:", JSON.stringify(sim.value.err));
    return;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig);
  console.log("BUY TX:", sig);

  const bal = await getAccount(conn, userAta);
  console.log("Token balance:", Number(bal.amount) / 1e9);
  console.log("SOL balance:", (await conn.getBalance(keypair.publicKey)) / 1e9);
  console.log("\nSUCCESS!");
}

main().catch(console.error);