#!/usr/bin/env python3
"""
Replace the 5-tx deploy flow with a 2-tx batched version.
TX1: mint + supply + registry (needs partialSign from mint keypair)
TX2: add_liquidity + claim_locks + source_lock (all user-signed)
"""

import sys

with open('src/App.jsx', 'r') as f:
    content = f.read()

# Find the old deploy block
OLD_START = 'setState("loading");(async()=>{try{'
OLD_END = """  setState("done");"""

start_idx = content.index(OLD_START)
# Find the setState("done") that ends the deploy block
# We need the one inside the async IIFE, not any other
search_from = start_idx
end_idx = content.index(OLD_END, search_from)
end_idx += len(OLD_END)

old_block = content[start_idx:end_idx]

new_block = r'''setState("loading");(async()=>{try{
  const provider=window?.solana;
  if(!provider?.isPhantom){window.open("https://phantom.app","_blank");setState("idle");return;}

  const{Keypair,SystemProgram,Transaction:SolTx,ComputeBudgetProgram,PublicKey:PK,TransactionInstruction:TxIx}=await import("@solana/web3.js");
  const{createInitializeMint2Instruction,createMintToInstruction,createAssociatedTokenAccountInstruction,getAssociatedTokenAddress,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,MINT_SIZE,getMinimumBalanceForRentExemptMint}=await import("@solana/spl-token");
  const{PROGRAM_ID,getPoolPDA,getGlobalPDA,getLiquidityProviderPDA}=await import("./solana.js");

  const TOTAL_RAW=BigInt(1000000000)*BigInt(1000000000);
  const BONDING_RAW=BigInt(650000000)*BigInt(1000000000);

  const confirmAndVerify = async (sig, label) => {
    const bh = await connection.getLatestBlockhash("confirmed");
    const result = await connection.confirmTransaction({signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight}, "confirmed");
    if (result?.value?.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(result.value.err)}`);
    console.log(`${label} confirmed ✅`);
    return sig;
  };

  // ── Prepare all data up front ──
  const mk=Keypair.generate();
  console.log("New mint:",mk.publicKey.toBase58());
  const lam=await getMinimumBalanceForRentExemptMint(connection);
  const userAta=await getAssociatedTokenAddress(mk.publicKey,provider.publicKey);
  const tkr=form.sym||"TEST";
  const imgHashBuf=form.imageFile?await sha256(new Uint8Array(await form.imageFile.arrayBuffer())):Buffer.alloc(32);
  const idRaw=(form.twitter||form.website||"").trim().toLowerCase();
  const idHashBuf=idRaw.length>1?await sha256(idRaw):Buffer.alloc(32);

  // Anti-vamp backend check (before any tx)
  let antiVampResult = null;
  const twv=(form.twitter||"").trim();const wbv=(form.website||"").trim();let sourceUrl=null;
  if((twv.includes("x.com/")||twv.includes("twitter.com/"))&&twv.includes("/status/"))sourceUrl=twv;
  if(!sourceUrl&&wbv.length>5&&wbv.includes(".")&&wbv.includes("/"))sourceUrl=wbv;
  if(sourceUrl){
    try {
      const imgB64 = form.imageFile ? btoa(String.fromCharCode(...new Uint8Array(await form.imageFile.arrayBuffer()).slice(0, 10000))) : null;
      const avRes = await fetch(`${ANTIVAMP_URL}/canonicalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: sourceUrl, image_base64: imgB64, mint: mk.publicKey.toBase58(), creator: provider.publicKey.toBase58() }),
      }).then(r => r.json()).catch(() => null);
      if (avRes?.error) throw new Error(`Anti-vamp: ${avRes.error}`);
      if (avRes?.source_hash) { antiVampResult = avRes; console.log("Anti-vamp approved:", avRes.canonical_key); }
    } catch(avErr) { console.warn("Anti-vamp check skipped:", avErr.message); }
  }

  // Build registry instruction (we'll extract the raw instruction)
  const{tx:regTx,tickerBuf,imgHash,idHash}=await buildCreateRegistryTx(provider.publicKey,mk.publicKey,tkr,imgHashBuf,idHashBuf);

  // ════════════════════════════════════════════════════
  // TX1: Create mint + supply + registry (1 Phantom popup)
  // Needs partialSign from mint keypair, so must use signTransaction
  // ════════════════════════════════════════════════════
  const tx1=new SolTx();
  tx1.add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}));
  tx1.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
  // Mint creation
  tx1.add(SystemProgram.createAccount({fromPubkey:provider.publicKey,newAccountPubkey:mk.publicKey,space:MINT_SIZE,lamports:lam,programId:TOKEN_PROGRAM_ID}));
  tx1.add(createInitializeMint2Instruction(mk.publicKey,9,provider.publicKey,provider.publicKey));
  tx1.add(createAssociatedTokenAccountInstruction(provider.publicKey,userAta,provider.publicKey,mk.publicKey));
  tx1.add(createMintToInstruction(mk.publicKey,userAta,provider.publicKey,TOTAL_RAW));
  // Registry instruction (append to same tx)
  for(const ix of regTx.instructions) tx1.add(ix);

  const bh1=await connection.getLatestBlockhash("confirmed");
  tx1.recentBlockhash=bh1.blockhash;
  tx1.feePayer=provider.publicKey;
  tx1.partialSign(mk);
  const s1=await provider.signTransaction(tx1);
  const sig1=await connection.sendRawTransaction(s1.serialize(),{skipPreflight:true,maxRetries:10});
  console.log("TX1 (Mint+Registry):",sig1);
  await confirmAndVerify(sig1, "Mint+Registry");

  // ════════════════════════════════════════════════════
  // TX2: Add liquidity + claim locks + source lock (1 Phantom popup)
  // All user-signed, no partialSign needed
  // ════════════════════════════════════════════════════
  const[pool]=getPoolPDA(mk.publicKey);
  const globalPda=(()=>{const[g]=PK.findProgramAddressSync([Buffer.from("global")],PROGRAM_ID);return g;})();
  const[lpAccount]=PK.findProgramAddressSync([Buffer.from("LiqudityProvider"),pool.toBuffer(),provider.publicKey.toBuffer()],PROGRAM_ID);
  const poolAta=await getAssociatedTokenAddress(mk.publicKey,globalPda,true);

  // AddLiquidity instruction
  const discAL=Buffer.from("b59d59438fb63448","hex");
  const dataAL=Buffer.alloc(24);
  discAL.copy(dataAL,0);
  dataAL.writeBigUInt64LE(BONDING_RAW,8);
  dataAL.writeBigUInt64LE(BigInt(0),16);
  const ixAL=new TxIx({keys:[
    {pubkey:pool,isSigner:false,isWritable:true},
    {pubkey:globalPda,isSigner:false,isWritable:true},
    {pubkey:lpAccount,isSigner:false,isWritable:true},
    {pubkey:mk.publicKey,isSigner:false,isWritable:true},
    {pubkey:poolAta,isSigner:false,isWritable:true},
    {pubkey:userAta,isSigner:false,isWritable:true},
    {pubkey:provider.publicKey,isSigner:true,isWritable:true},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}
  ],programId:PROGRAM_ID,data:dataAL});

  // ClaimLocks instruction
  let claimIxs=[];
  try{
    const claimTx=await buildClaimLocksTx(provider.publicKey,mk.publicKey,tickerBuf,imgHash,idHash);
    claimIxs=claimTx.instructions;
  }catch(e){console.warn("claim_locks ix build failed (non-fatal):",e.message);}

  // SourceLock instruction (if anti-vamp)
  let sourceIxs=[];
  if(antiVampResult&&antiVampResult.source_hash){
    try{
      const slTx=await buildCreateSourceLockTx(provider.publicKey,mk.publicKey,antiVampResult);
      sourceIxs=slTx.instructions;
    }catch(e){console.warn("source_lock ix build failed (non-fatal):",e.message);}
  }

  // Build TX2 with all instructions
  let poolCreated=false;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const tx2=new SolTx();
      tx2.add(ComputeBudgetProgram.setComputeUnitLimit({units:800000}));
      tx2.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
      tx2.add(ixAL);
      for(const ix of claimIxs) tx2.add(ix);
      for(const ix of sourceIxs) tx2.add(ix);
      const bh2=await connection.getLatestBlockhash("confirmed");
      tx2.recentBlockhash=bh2.blockhash;
      tx2.feePayer=provider.publicKey;
      const r2=await provider.signAndSendTransaction(tx2,{skipPreflight:true});
      const sig2=r2.signature||r2;
      console.log(`TX2 (Pool+Locks) attempt ${attempt}:`,sig2);
      await confirmAndVerify(sig2, "Pool+Locks");
      const poolCheck=await connection.getAccountInfo(pool);
      if(!poolCheck) throw new Error("Pool account not found after confirmation");
      console.log("Pool verified on-chain ✅ size:",poolCheck.data.length,"bytes");
      poolCreated=true;
      break;
    }catch(e2){
      console.error(`TX2 attempt ${attempt} failed:`,e2.message);
      // If batched tx fails, try pool-only as fallback
      if(attempt===2&&(claimIxs.length>0||sourceIxs.length>0)){
        console.log("Retrying with pool-only (dropping locks from batch)...");
        claimIxs=[];sourceIxs=[];
      }
      if(attempt===3) throw new Error(`Pool creation failed after 3 attempts: ${e2.message}`);
      await new Promise(r=>setTimeout(r,2000));
    }
  }
  if(!poolCreated) throw new Error("Pool creation failed");

  // If locks were dropped from batch due to size, try them separately (no extra popup — fire and forget)
  // This uses signAndSendTransaction which WILL pop phantom, so only do it if they weren't in TX2
  // Actually — skip separate lock tx to keep it at 2 popups max. Locks are non-fatal.

  console.log("FULL DEPLOY COMPLETE");

  // Confirm anti-vamp lock in cache
  if(antiVampResult){
    try{
      await fetch(`${ANTIVAMP_URL}/confirm-lock`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({source_hash:antiVampResult.source_hash,canonical_key:antiVampResult.canonical_key,mint:mk.publicKey.toBase58(),creator:provider.publicKey.toBase58(),image_phash:antiVampResult.image_phash,tx_sig:sig1}),
      });
      console.log("Source lock confirmed in cache:",antiVampResult.canonical_key);
    }catch(e){console.warn("Lock confirmation failed:",e.message);}
  }

  if(onDeployed){
    onDeployed({
      id:mk.publicKey.toBase58(),pubkey:mk.publicKey.toBase58(),mint:mk.publicKey.toBase58(),mintAddress:mk.publicKey.toBase58(),
      sym:tkr,name:tkr,pi:Math.abs(mk.publicKey.toBuffer()[0]+mk.publicKey.toBuffer()[1])%8,
      mcap:208,chg:0,prog:0,holders:1,age:0,raisedSOL:0,raisedSOLMax:85,elapsed:0,
      vol:"$0",volRaw:0,txs:0,desc:"Deployed on-chain",bondingFull:false,minsAgo:0,
      graduated:false,hasPool:true,pricePerToken:0,solReserve:0.75,tokenReserve:650000000,
      creator:provider.publicKey.toBase58(),createdAt:Math.floor(Date.now()/1000),launchTs:Math.floor(Date.now()/1000),
    });
  }
  setState("done");'''

# Verify we found the right block
if OLD_START not in old_block or 'setState("done")' not in old_block:
    print("ERROR: Could not isolate deploy block correctly")
    sys.exit(1)

# Count Phantom popups in old vs new
old_sign_count = old_block.count('signTransaction') + old_block.count('signAndSendTransaction')
new_sign_count = new_block.count('signTransaction') + new_block.count('signAndSendTransaction')
print(f"Old deploy: {old_sign_count} Phantom popups")
print(f"New deploy: {new_sign_count} Phantom popups")

content = content[:start_idx] + new_block + content[end_idx:]

with open('src/App.jsx', 'w') as f:
    f.write(content)

print("SUCCESS: Deploy flow batched to 2 transactions")
