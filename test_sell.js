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
  const poolAta = PublicKey.findProgramAddressSync([globalAccount.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  const userAta = PublicKey.findProgramAddressSync([keypair.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  const beforeBal = await getAccount(conn, userAta);
  const beforeSol = await conn.getBalance(keypair.publicKey);
  console.log("Before - Tokens:", Number(beforeBal.amount) / 1e9, "SOL:", beforeSol / 1e9);
  console.log("Selling 1000 tokens...");
  const disc = Buffer.from("f8c69e91e17587c8", "hex");
  const sellAmount = Buffer.alloc(8);
  sellAmount.writeBigUInt64LE(BigInt(1000) * BigInt(1000000000), 0);
  const sellStyle = Buffer.alloc(8);
  sellStyle.writeBigUInt64LE(BigInt(1), 0);
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
    data: Buffer.concat([disc, sellAmount, sellStyle]),
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(keypair);
  const sim = await conn.simulateTransaction(tx);
  console.log("Simulation:");
  sim.value.logs.forEach(function(l) { console.log(" ", l); });
  if (sim.value.err) {
    console.log("ERROR:", JSON.stringify(sim.value.err));
    return;
  }
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig);
  console.log("SELL TX:", sig);
  const afterBal = await getAccount(conn, userAta);
  const afterSol = await conn.getBalance(keypair.publicKey);
  console.log("After - Tokens:", Number(afterBal.amount) / 1e9, "SOL:", afterSol / 1e9);
  console.log("SOL gained:", (afterSol - beforeSol) / 1e9);
  console.log("SUCCESS!");
}
main().catch(console.error);