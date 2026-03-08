const {Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY} = require("@solana/web3.js");
const fs = require("fs");

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/home/codespace/.config/solana/id.json"))));
  const programId = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");

  const [curveConfig] = PublicKey.findProgramAddressSync([Buffer.from("CurveConfiguration")], programId);
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from("global")], programId);

  console.log("Wallet:", keypair.publicKey.toBase58());
  console.log("CurveConfig:", curveConfig.toBase58());
  console.log("Global:", globalAccount.toBase58());

  const disc = Buffer.from("afaf6d1f0d989bed", "hex");
  const fee = Buffer.alloc(8);
  fee.writeDoubleLE(1.5, 0);
  const data = Buffer.concat([disc, fee, keypair.publicKey.toBuffer(), keypair.publicKey.toBuffer()]);
  console.log("Data length:", data.length, "Data hex:", data.slice(0, 16).toString("hex"));

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(keypair);

  const sim = await conn.simulateTransaction(tx);
  console.log("Simulation logs:", sim.value.logs);
  console.log("Error:", sim.value.err);

  if (!sim.value.err) {
    const sig = await conn.sendRawTransaction(tx.serialize());
    console.log("TX:", sig);
    await conn.confirmTransaction(sig);
    console.log("Confirmed!");
  }
}
main().catch(console.error);