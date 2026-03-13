#!/usr/bin/env python3
"""
Add buildCreateSourceLockTx and getSourceLockPDA to solana.js
Also add the Ed25519Program import and create_source_lock discriminator
"""

path = "frontend/src/solana.js"
with open(path, "r") as f:
    content = f.read()

# ── EDIT 1: Add Ed25519Program to the import ──
old_import = "import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js'"
new_import = "import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, Ed25519Program } from '@solana/web3.js'"

if old_import in content:
    content = content.replace(old_import, new_import)
    print("✅ Edit 1: Added Ed25519Program import")
else:
    print("⚠️  Edit 1: Import line not found exactly")

# ── EDIT 2: Add create_source_lock discriminator ──
old_disc = """  claim_locks:   Buffer.from('50ac2a7b3fc26165', 'hex'),
}"""
new_disc = """  claim_locks:   Buffer.from('50ac2a7b3fc26165', 'hex'),
  create_source_lock: Buffer.from('', 'hex'), // Will be computed from anchor discriminator
}"""

# Actually, we need to compute the discriminator. For Anchor, it's sha256("global:create_source_lock")[0..8]
# We'll hardcode a placeholder and compute it after the build.
# For now, let's use the anchor pattern: first 8 bytes of sha256("global:create_source_lock")
# We can't compute it here, so we'll add it as a placeholder that needs updating after build.

# Better approach: compute it in JS at runtime
old_disc2 = """  claim_locks:   Buffer.from('50ac2a7b3fc26165', 'hex'),
}"""
new_disc2 = """  claim_locks:   Buffer.from('50ac2a7b3fc26165', 'hex'),
}

// create_source_lock discriminator will be computed at build time
// For now we compute it from the anchor convention: sha256("global:create_source_lock")[0..8]
let CREATE_SOURCE_LOCK_DISC = null
async function getSourceLockDisc() {
  if (CREATE_SOURCE_LOCK_DISC) return CREATE_SOURCE_LOCK_DISC
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('global:create_source_lock'))
  CREATE_SOURCE_LOCK_DISC = Buffer.from(new Uint8Array(hash).slice(0, 8))
  return CREATE_SOURCE_LOCK_DISC
}"""

if old_disc2 in content:
    content = content.replace(old_disc2, new_disc2)
    print("✅ Edit 2: Added create_source_lock discriminator helper")
else:
    print("⚠️  Edit 2: Discriminator block not found")

# ── EDIT 3: Add getSourceLockPDA after getTokenRegistryPDA ──
old_pda = """export function getTokenRegistryPDA(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('token_registry'), mint.toBuffer()], PROGRAM_ID)
}"""

new_pda = """export function getTokenRegistryPDA(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('token_registry'), mint.toBuffer()], PROGRAM_ID)
}
export function getSourceLockPDA(sourceHash) {
  return PublicKey.findProgramAddressSync([Buffer.from('source_lock'), sourceHash], PROGRAM_ID)
}
export function getDexConfigPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from('CurveConfiguration')], PROGRAM_ID)
}"""

if old_pda in content:
    content = content.replace(old_pda, new_pda)
    print("✅ Edit 3: Added getSourceLockPDA and getDexConfigPDA")
else:
    print("⚠️  Edit 3: getTokenRegistryPDA block not found")

# ── EDIT 4: Add buildCreateSourceLockTx function before fetchDeployedTokens ──
new_function = '''
// ══════════════════════════════════════════════════════════════
// create_source_lock — Ed25519 verified source claim
// antiVampResult = { source_hash, image_phash, signature, signer_pubkey, expiry_timestamp }
// ══════════════════════════════════════════════════════════════
export async function buildCreateSourceLockTx(creatorPubkey, mintPubkey, antiVampResult) {
  const mint = new PublicKey(mintPubkey)
  const creator = creatorPubkey instanceof PublicKey ? creatorPubkey : new PublicKey(creatorPubkey)

  const sourceHashBuf = Buffer.from(antiVampResult.source_hash, 'hex') // 32 bytes
  const imagePhashBuf = Buffer.from(antiVampResult.image_phash, 'hex') // 8 bytes
  const signatureBuf = Buffer.from(antiVampResult.signature, 'hex')    // 64 bytes
  const signerPubkeyBytes = new PublicKey(antiVampResult.signer_pubkey).toBytes() // 32 bytes
  const expiryTimestamp = antiVampResult.expiry_timestamp

  // Build the 112-byte message that was signed
  const message = Buffer.alloc(112)
  sourceHashBuf.copy(message, 0)       // 0..32
  imagePhashBuf.copy(message, 32)      // 32..40
  mint.toBuffer().copy(message, 40)    // 40..72
  creator.toBuffer().copy(message, 72) // 72..104
  const expiryBuf = Buffer.alloc(8)
  expiryBuf.writeBigInt64LE(BigInt(expiryTimestamp))
  expiryBuf.copy(message, 104)         // 104..112

  // 1. Ed25519 verify instruction (must be FIRST in the transaction)
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: signerPubkeyBytes,
    message: message,
    signature: signatureBuf,
  })

  // 2. Our create_source_lock instruction
  const [sourceLock] = getSourceLockPDA(sourceHashBuf)
  const [dexConfig] = getDexConfigPDA()
  const SYSVAR_IX = new PublicKey('Sysvar1nstructions1111111111111111111111111')

  const disc = await getSourceLockDisc()

  // Instruction data: disc(8) + source_hash(32) + image_phash(8) + expiry_timestamp(8) + ed25519_sig(64) + ed25519_pubkey(32)
  const data = Buffer.alloc(8 + 32 + 8 + 8 + 64 + 32)
  disc.copy(data, 0)
  sourceHashBuf.copy(data, 8)
  imagePhashBuf.copy(data, 40)
  expiryBuf.copy(data, 48)
  signatureBuf.copy(data, 56)
  Buffer.from(signerPubkeyBytes).copy(data, 120)

  const sourceLockIx = new TransactionInstruction({
    keys: [
      { pubkey: sourceLock,   isSigner: false, isWritable: true  },
      { pubkey: dexConfig,    isSigner: false, isWritable: false },
      { pubkey: mint,         isSigner: false, isWritable: false },
      { pubkey: creator,      isSigner: true,  isWritable: true  },
      { pubkey: SYSVAR_IX,    isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  })

  const tx = new Transaction()
  tx.add(ed25519Ix)      // MUST be first — the on-chain program reads this from instruction sysvar
  tx.add(sourceLockIx)   // Our instruction reads the Ed25519 ix above

  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = creator

  return tx
}

'''

# Insert before fetchDeployedTokens
marker = "// ══════════════════════════════════════════════════════════════\n// Fetch all TokenRegistry accounts"
if marker in content:
    content = content.replace(marker, new_function + marker)
    print("✅ Edit 4: Added buildCreateSourceLockTx function")
else:
    print("⚠️  Edit 4: fetchDeployedTokens marker not found")

with open(path, "w") as f:
    f.write(content)

print("\n✅ All edits applied to", path)
print("Run: git add . && git commit -m 'frontend: add buildCreateSourceLockTx' && git push")
