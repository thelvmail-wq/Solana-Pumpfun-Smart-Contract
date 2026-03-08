const {Connection, PublicKey} = require("@solana/web3.js");
async function check() {
  const conn = new Connection("https://api.devnet.solana.com");
  const programId = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");
  const [curveConfig] = PublicKey.findProgramAddressSync([Buffer.from("CurveConfiguration")], programId);
  const info = await conn.getAccountInfo(curveConfig);
  console.log("CurveConfig exists:", !!info);
  if(info) console.log("Size:", info.data.length);
  const [global] = PublicKey.findProgramAddressSync([Buffer.from("global")], programId);
  const gInfo = await conn.getAccountInfo(global);
  console.log("Global exists:", !!gInfo);
  if(gInfo) console.log("Global size:", gInfo.data.length, "lamports:", gInfo.lamports);
}
check();