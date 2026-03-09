const{Connection}=require("@solana/web3.js");
const c=new Connection("https://api.devnet.solana.com","confirmed");
c.getTransaction("zTGUvYQiTWWgCSuK2nJRXKMk2ZT8eymJijU83rAqjt2W96bPwU9cLm2uLamWAN86xYk8GuCE5CfeuwFdxEtqPiL",{maxSupportedTransactionVersion:0}).then(function(tx){
  if(tx===null){console.log("TX not found");return;}
  console.log("Status:",tx.meta&&tx.meta.err?JSON.stringify(tx.meta.err):"OK");
  console.log("Logs:");
  if(tx.meta&&tx.meta.logMessages){tx.meta.logMessages.forEach(function(l){console.log("  ",l);});}
});
