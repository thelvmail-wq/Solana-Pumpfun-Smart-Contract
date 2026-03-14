const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("BQ51fq1UavsR8typUWE4y4EsYN7tSF1cVfU27wVrHP6C");

const walletKey = JSON.parse(fs.readFileSync("./id.json", "utf-8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(walletKey));
console.log("Wallet:", wallet.publicKey.toBase58());

const [dexConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("CurveConfiguration")], PROGRAM_ID
);
const [globalAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from("global")], PROGRAM_ID
);
console.log("DexConfig PDA:", dexConfig.toBase58());
console.log("Global PDA:", globalAccount.toBase58());

const crypto = require("crypto");
const disc = crypto.createHash("sha256").update("global:initialize").digest().slice(0, 8);

const feeBuf = Buffer.alloc(8);
feeBuf.writeDoubleLE(1.5, 0);

const data = Buffer.concat([
  disc,
  feeBuf,
  wallet.publicKey.toBuffer(),
  wallet.publicKey.toBuffer(),
  wallet.publicKey.toBuffer(),
]);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: dexConfig, isSigner: false, isWritable: true },
    { pubkey: globalAccount, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  if (balance < 10_000_000) {
    console.log("Low balance, requesting airdrop...");
    const sig = await connection.requestAirdrop(wallet.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);
    console.log("Airdrop received");
  }
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(txSig);
  console.log("Initialized! TX:", txSig);
}

main().catch(console.error);
