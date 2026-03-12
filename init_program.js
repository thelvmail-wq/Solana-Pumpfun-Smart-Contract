const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("73wyBdTRbZPegtYQbjs4uCAvkiUK9wWKd91WWJHyYL3j");
const DISC_INITIALIZE = Buffer.from("afaf6d1f0d989bed", "hex");
const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./id.json", "utf-8"))));
  
  console.log("Wallet:", keypair.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(keypair.publicKey)) / LAMPORTS_PER_SOL, "SOL");

  const [curveConfig] = PublicKey.findProgramAddressSync([Buffer.from("CurveConfiguration")], PROGRAM_ID);
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from("global")], PROGRAM_ID);

  const existing = await connection.getAccountInfo(curveConfig);
  if (existing) { console.log("Already initialized!"); return; }

  console.log("Initializing...");
  const feeBuffer = Buffer.alloc(8);
  feeBuffer.writeDoubleLE(1.5, 0);

  const data = Buffer.concat([
    DISC_INITIALIZE,
    feeBuffer,
    keypair.publicKey.toBuffer(),  // protocol_wallet
    keypair.publicKey.toBuffer(),  // airdrop_wallet
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: curveConfig,             isSigner: false, isWritable: true  },
      { pubkey: globalAccount,           isSigner: false, isWritable: true  },
      { pubkey: keypair.publicKey,       isSigner: true,  isWritable: true  },
      { pubkey: SYSVAR_RENT,             isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(keypair);

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  console.log("Initialized! Tx:", sig);
}

main().catch(console.error);
