const{Connection}=require("@solana/web3.js");
const c=new Connection("https://api.devnet.solana.com","confirmed");
c.getTransaction("43GmFVfP6zHfW3XL4U9CucEXcNPMxXeNxGGoB4SCNp3HBN8U3RuqcQvgHWswWT27Vy51LMUVSQH6CkCBs38Yy1x4",{maxSupportedTransactionVersion:0}).then(function(tx){
  if(tx===null){console.log("TX not found");return;}
  console.log("Status:",tx.meta&&tx.meta.err?JSON.stringify(tx.meta.err):"OK");
  if(tx.meta&&tx.meta.logMessages){tx.meta.logMessages.forEach(function(l){console.log(" ",l);});}
});
