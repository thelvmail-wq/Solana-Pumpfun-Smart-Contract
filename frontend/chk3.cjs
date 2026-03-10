const{Connection,PublicKey}=require("@solana/web3.js");
const c=new Connection("https://api.devnet.solana.com","confirmed");
const PID=new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");
c.getProgramAccounts(PID,{filters:[{dataSize:170}]}).then(function(accts){
  console.log("Pools found:",accts.length);
  accts.forEach(function(a){
    var d=a.account.data;
    var mint=new PublicKey(d.slice(8,40));
    var r1=Number(d.readBigUInt64LE(80));
    var r2=Number(d.readBigUInt64LE(88));
    var raised=Number(d.readBigUInt64LE(106));
    console.log("Mint:",mint.toBase58().slice(0,8),"| tokenRes:",r1,"| solRes:",r2,"| raised:",raised/1e9,"SOL");
  });
});
