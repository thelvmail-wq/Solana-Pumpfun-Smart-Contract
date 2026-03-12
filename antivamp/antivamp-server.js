// ================================================
// SUMMIT.MOON — Anti-Vamp Canonicalization Service
// 
// One tweet = one CA. First deploy wins.
// 
// Endpoints:
//   POST /canonicalize  — takes source URL, returns signed hashes
//   GET  /health        — health check
//
// Deploy: Railway / Fly.io / any Node host
// ================================================

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import sharp from 'sharp';

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────
const PORT = process.env.PORT || 3002;

// Backend signing keypair — stored as base58 secret in env
// Generate one: node -e "const{Keypair}=require('@solana/web3.js');const k=Keypair.generate();console.log('PUBKEY:',k.publicKey.toBase58());console.log('SECRET:',Buffer.from(k.secretKey).toString('hex'))"
const SIGNER_SECRET = process.env.SIGNER_SECRET_HEX;
let signerKeypair;
if (SIGNER_SECRET) {
  signerKeypair = Keypair.fromSecretKey(Buffer.from(SIGNER_SECRET, 'hex'));
  console.log('Signer pubkey:', signerKeypair.publicKey.toBase58());
} else {
  // Dev mode — generate ephemeral keypair
  signerKeypair = Keypair.generate();
  console.log('DEV MODE — ephemeral signer:', signerKeypair.publicKey.toBase58());
  console.log('Set SIGNER_SECRET_HEX env for production');
}

// ── URL Canonicalization ──────────────────────────

/**
 * Canonicalize a tweet URL to: x:{tweet_id}
 * Handles: x.com, twitter.com, mobile, tracking params, status URLs
 */
function canonicalizeTweet(url) {
  const cleaned = url.trim().toLowerCase().replace(/\/$/, '');
  
  // Extract tweet ID from various URL formats
  // x.com/user/status/1234567890
  // twitter.com/user/status/1234567890
  // x.com/i/web/status/1234567890
  // mobile.twitter.com/user/status/1234567890
  const statusMatch = cleaned.match(/(?:x\.com|twitter\.com)\/(?:.*?)\/status\/(\d+)/);
  if (statusMatch) {
    return `x:${statusMatch[1]}`;
  }
  
  // Direct status URL: x.com/i/status/1234567890
  const directMatch = cleaned.match(/(?:x\.com|twitter\.com)\/i\/(?:web\/)?status\/(\d+)/);
  if (directMatch) {
    return `x:${directMatch[1]}`;
  }
  
  return null;
}

/**
 * Canonicalize an article URL to: article:{domain}/{path}
 * Strips www, query params, fragments, trailing slashes
 */
function canonicalizeArticle(url) {
  try {
    const cleaned = url.trim();
    const withProto = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withProto);
    
    // Strip www
    const host = parsed.hostname.replace(/^www\./, '');
    
    // Strip query params and fragment
    const path = parsed.pathname.replace(/\/$/, '');
    
    if (!path || path === '') {
      return null; // Just a domain, not an article
    }
    
    return `article:${host}${path}`;
  } catch (e) {
    return null;
  }
}

/**
 * Main canonicalization — detect type and normalize
 */
function canonicalizeUrl(url) {
  if (!url || url.trim().length < 5) return null;
  
  const s = url.trim().toLowerCase();
  
  // Is it a tweet?
  if (s.includes('x.com/') || s.includes('twitter.com/')) {
    // Must be a status/tweet URL, not just a profile
    if (s.includes('/status/')) {
      return canonicalizeTweet(s);
    }
    // Profile URL — not lockable
    return null;
  }
  
  // Is it a web article?
  if (s.includes('.') && (s.includes('/') || s.startsWith('http'))) {
    return canonicalizeArticle(s);
  }
  
  return null;
}

// ── Perceptual Hash (pHash) ──────────────────────

/**
 * Compute 64-bit perceptual hash of an image
 * 1. Resize to 32x32 grayscale
 * 2. Apply DCT
 * 3. Take top-left 8x8
 * 4. Compare to median
 * 5. Output 64-bit hash as hex
 */
async function computePhash(imageBuffer) {
  try {
    // Resize to 32x32 grayscale
    const pixels = await sharp(imageBuffer)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    // Simple DCT-like hash using average
    // (Full DCT is more accurate but this is sufficient for V1)
    const size = 32;
    const vals = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let py = 0; py < size; py++) {
          for (let px = 0; px < size; px++) {
            const pixel = pixels[py * size + px];
            sum += pixel * Math.cos(Math.PI / size * (py + 0.5) * y) 
                       * Math.cos(Math.PI / size * (px + 0.5) * x);
          }
        }
        vals.push(sum);
      }
    }
    
    // Compute median
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Generate 64-bit hash
    let hash = BigInt(0);
    for (let i = 0; i < 64; i++) {
      if (vals[i] > median) {
        hash |= BigInt(1) << BigInt(i);
      }
    }
    
    // Return as 16-char hex string (8 bytes)
    return hash.toString(16).padStart(16, '0');
  } catch (e) {
    console.error('pHash error:', e.message);
    return null;
  }
}

/**
 * Hamming distance between two hex hash strings
 */
function hammingDistance(hash1, hash2) {
  const a = BigInt('0x' + hash1);
  const b = BigInt('0x' + hash2);
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

// ── Signing ──────────────────────────────────────

/**
 * Sign data with backend Ed25519 key
 */
function signData(data) {
  const message = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const signature = nacl.sign.detached(message, signerKeypair.secretKey);
  return Buffer.from(signature).toString('hex');
}

// ── Lock Storage (Supabase) ──────────────────────

// In production, check locks against Supabase
// For now, use in-memory store
const activeLocks = new Map(); // canonicalKey -> { mint, timestamp, phash }

function checkLock(canonicalKey) {
  return activeLocks.get(canonicalKey) || null;
}

function setLock(canonicalKey, mint, phash) {
  activeLocks.set(canonicalKey, { mint, timestamp: Date.now(), phash });
}

// ── API Endpoints ────────────────────────────────

app.post('/canonicalize', async (req, res) => {
  try {
    const { source_url, image_base64, ticker } = req.body;
    
    if (!source_url) {
      return res.status(400).json({ error: 'source_url is required' });
    }
    
    // Step 1: Canonicalize the URL
    const canonicalKey = canonicalizeUrl(source_url);
    if (!canonicalKey) {
      return res.status(400).json({ 
        error: 'Invalid source URL. Must be a tweet (x.com/.../status/...) or article URL.',
        hint: 'Profile URLs, domains, and keywords are not lockable.'
      });
    }
    
    // Step 2: Check if already locked
    const existingLock = checkLock(canonicalKey);
    if (existingLock) {
      return res.status(409).json({
        error: 'Source already claimed',
        canonical_key: canonicalKey,
        locked_by: existingLock.mint,
        locked_at: existingLock.timestamp,
      });
    }
    
    // Step 3: Compute source hash
    const sourceHash = crypto.createHash('sha256').update(canonicalKey).digest('hex');
    
    // Step 4: Compute image pHash if provided
    let imagePhash = '0000000000000000'; // default empty
    if (image_base64) {
      const imgBuffer = Buffer.from(image_base64, 'base64');
      const phash = await computePhash(imgBuffer);
      if (phash) {
        imagePhash = phash;
        
        // Check for similar images in existing locks
        for (const [key, lock] of activeLocks.entries()) {
          if (lock.phash && lock.phash !== '0000000000000000') {
            const dist = hammingDistance(imagePhash, lock.phash);
            if (dist <= 10) {
              return res.status(409).json({
                error: 'Similar image already locked',
                canonical_key: key,
                locked_by: lock.mint,
                hamming_distance: dist,
              });
            }
          }
        }
      }
    }
    
    // Step 5: Sign the hashes
    const payload = Buffer.concat([
      Buffer.from(sourceHash, 'hex'),     // 32 bytes
      Buffer.from(imagePhash, 'hex'),      // 8 bytes
    ]);
    const signature = signData(payload);
    
    // Step 6: Return signed hashes
    res.json({
      canonical_key: canonicalKey,
      source_hash: sourceHash,
      image_phash: imagePhash,
      signature: signature,
      signer_pubkey: signerKeypair.publicKey.toBase58(),
      // Frontend uses these to build the on-chain transaction
    });
    
  } catch (e) {
    console.error('Canonicalize error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lock confirmation — called after successful on-chain deploy
app.post('/confirm-lock', (req, res) => {
  try {
    const { canonical_key, mint, phash } = req.body;
    if (!canonical_key || !mint) {
      return res.status(400).json({ error: 'canonical_key and mint required' });
    }
    setLock(canonical_key, mint, phash || '0000000000000000');
    res.json({ status: 'locked', canonical_key, mint });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if a URL is available
app.get('/check', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  
  const canonicalKey = canonicalizeUrl(url);
  if (!canonicalKey) {
    return res.json({ available: false, reason: 'Invalid URL format' });
  }
  
  const lock = checkLock(canonicalKey);
  res.json({
    available: !lock,
    canonical_key: canonicalKey,
    locked_by: lock?.mint || null,
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    signer: signerKeypair.publicKey.toBase58(),
    locks: activeLocks.size,
  });
});

// ── Start ────────────────────────────────────────

app.listen(PORT, () => {
  console.log('========================================');
  console.log('SUMMIT.MOON Anti-Vamp Service');
  console.log(`Port: ${PORT}`);
  console.log(`Signer: ${signerKeypair.publicKey.toBase58()}`);
  console.log('========================================');
});
