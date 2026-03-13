// ================================================
// SUMMIT.MOON — Anti-Vamp Canonicalization Service
// 
// One tweet = one CA. First deploy wins.
// Chain is the only real authority.
// Backend canonicalizes + signs. Supabase is cache.
// 
// Endpoints:
//   POST /canonicalize  — takes source URL + mint + creator, returns signed payload
//   POST /confirm-lock  — called after on-chain deploy succeeds
//   GET  /check          — check if a URL is available
//   GET  /health         — health check
//
// Deploy: Railway
// ================================================

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── Config ────────────────────────────────────────
const PORT = process.env.PORT || 3002;
const SIGNATURE_TTL_SEC = 120; // signatures expire after 2 minutes
const PHASH_HAMMING_THRESHOLD = 10;
const TWEET_FRESHNESS_SEC = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

// ── Signer Keypair ────────────────────────────────
const SIGNER_SECRET = process.env.SIGNER_SECRET_HEX;
let signerKeypair;
if (SIGNER_SECRET) {
  signerKeypair = Keypair.fromSecretKey(Buffer.from(SIGNER_SECRET, 'hex'));
  console.log('Signer pubkey:', signerKeypair.publicKey.toBase58());
} else {
  signerKeypair = Keypair.generate();
  console.log('DEV MODE — ephemeral signer:', signerKeypair.publicKey.toBase58());
  console.log('Set SIGNER_SECRET_HEX env for production');
}

// ── Supabase ──────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('Supabase connected:', SUPABASE_URL);
} else {
  console.log('WARNING: No Supabase credentials — locks will NOT persist across restarts');
}

// ── Rate Limiter (in-memory, per IP) ──────────────
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Clean rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 300_000);

// ── URL Canonicalization ──────────────────────────

const TWITTER_EPOCH = 1288834974657n;

function tweetTimestampFromId(tweetId) {
  try {
    const id = BigInt(tweetId);
    return Number((id >> 22n) + TWITTER_EPOCH);
  } catch (e) {
    return null;
  }
}

function isTweetFreshEnough(tweetId) {
  const createdAt = tweetTimestampFromId(tweetId);
  if (!createdAt) return { fresh: false, reason: 'Invalid tweet ID' };
  
  const ageMs = Date.now() - createdAt;
  const ageSec = Math.floor(ageMs / 1000);
  
  if (ageMs < 0) return { fresh: true, ageSec: 0, createdAt };
  
  if (ageMs > TWEET_FRESHNESS_SEC * 1000) {
    return {
      fresh: false,
      ageSec,
      createdAt,
      reason: `Tweet is ${ageSec}s old. Source locks only available for tweets under ${TWEET_FRESHNESS_SEC} seconds old.`,
    };
  }
  
  return { fresh: true, ageSec, createdAt };
}

function canonicalizeTweet(url) {
  const cleaned = url.trim().toLowerCase().replace(/\/$/, '');
  
  const statusMatch = cleaned.match(/(?:x\.com|twitter\.com)\/(?:.*?)\/status\/(\d+)/);
  if (statusMatch) return { canonicalKey: `x:${statusMatch[1]}`, tweetId: statusMatch[1] };
  
  const directMatch = cleaned.match(/(?:x\.com|twitter\.com)\/i\/(?:web\/)?status\/(\d+)/);
  if (directMatch) return { canonicalKey: `x:${directMatch[1]}`, tweetId: directMatch[1] };
  
  return null;
}

function canonicalizeArticle(url) {
  try {
    const cleaned = url.trim();
    const withProto = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withProto);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/$/, '');
    if (!path || path === '') return null;
    return `article:${host}${path}`;
  } catch (e) {
    return null;
  }
}

function canonicalizeUrl(url) {
  if (!url || url.trim().length < 5) return null;
  const s = url.trim().toLowerCase();
  
  if (s.includes('x.com/') || s.includes('twitter.com/')) {
    if (s.includes('/status/')) {
      const result = canonicalizeTweet(s);
      if (!result) return null;
      const freshness = isTweetFreshEnough(result.tweetId);
      return { canonicalKey: result.canonicalKey, type: 'tweet', tweetId: result.tweetId, freshness };
    }
    return null;
  }
  
  if (s.includes('.') && (s.includes('/') || s.startsWith('http'))) {
    const key = canonicalizeArticle(s);
    if (!key) return null;
    return { canonicalKey: key, type: 'article', freshness: { fresh: true, ageSec: 0 } };
  }
  
  return null;
}

// ── Perceptual Hash (pHash) ──────────────────────

async function computePhash(imageBuffer) {
  try {
    const pixels = await sharp(imageBuffer)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
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
    
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    let hash = BigInt(0);
    for (let i = 0; i < 64; i++) {
      if (vals[i] > median) hash |= BigInt(1) << BigInt(i);
    }
    
    return hash.toString(16).padStart(16, '0');
  } catch (e) {
    console.error('pHash error:', e.message);
    return null;
  }
}

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

// ── Lock Storage (Supabase-backed) ───────────────

async function checkLock(sourceHash) {
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('source_locks')
        .select('*')
        .eq('source_hash', sourceHash)
        .limit(1);
      
      if (!error && data && data.length > 0) {
        return data[0];
      }
    } catch (e) {
      console.error('Supabase checkLock error:', e.message);
    }
  }
  return null;
}

async function setLock(sourceHash, canonicalKey, mint, creator, imagePhash, txSig) {
  if (supabase) {
    try {
      const { error } = await supabase
        .from('source_locks')
        .upsert({
          source_hash: sourceHash,
          canonical_key: canonicalKey,
          mint,
          creator,
          image_phash: imagePhash || '0000000000000000',
          tx_sig: txSig || null,
        }, { onConflict: 'source_hash' });
      
      if (error) {
        console.error('Supabase setLock error:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Supabase setLock error:', e.message);
      return false;
    }
  }
  return false;
}

async function checkImageSimilarity(imagePhash) {
  if (!supabase || imagePhash === '0000000000000000') return null;
  
  try {
    const { data, error } = await supabase
      .from('source_locks')
      .select('source_hash, canonical_key, mint, image_phash')
      .neq('image_phash', '0000000000000000');
    
    if (error || !data) return null;
    
    for (const lock of data) {
      const dist = hammingDistance(imagePhash, lock.image_phash);
      if (dist <= PHASH_HAMMING_THRESHOLD) {
        return { ...lock, hamming_distance: dist };
      }
    }
  } catch (e) {
    console.error('Image similarity check error:', e.message);
  }
  return null;
}

// ── Signing (112-byte payload) ───────────────────
//
// Payload layout:
//   source_hash     (32 bytes) — SHA-256 of canonical key
//   image_phash     (8 bytes)  — perceptual hash of source image
//   mint            (32 bytes) — token mint pubkey
//   creator         (32 bytes) — deployer wallet pubkey
//   expiry_timestamp (8 bytes) — unix timestamp (u64 LE), signature invalid after this
//
// Total: 112 bytes
//

function buildSignaturePayload(sourceHash, imagePhash, mint, creator, expiryTimestamp) {
  const sourceHashBuf = Buffer.from(sourceHash, 'hex'); // 32 bytes
  const phashBuf = Buffer.from(imagePhash, 'hex');      // 8 bytes
  const mintBuf = new PublicKey(mint).toBuffer();        // 32 bytes
  const creatorBuf = new PublicKey(creator).toBuffer();  // 32 bytes
  const expiryBuf = Buffer.alloc(8);
  expiryBuf.writeBigUInt64LE(BigInt(expiryTimestamp));   // 8 bytes
  
  return Buffer.concat([sourceHashBuf, phashBuf, mintBuf, creatorBuf, expiryBuf]);
}

function signPayload(payload) {
  const signature = nacl.sign.detached(payload, signerKeypair.secretKey);
  return Buffer.from(signature).toString('hex');
}

// ── API Endpoints ────────────────────────────────

app.post('/canonicalize', async (req, res) => {
  try {
    // Rate limit
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });
    }
    
    const { source_url, image_base64, mint, creator } = req.body;
    
    // Validate required fields
    if (!source_url) {
      return res.status(400).json({ error: 'source_url is required' });
    }
    if (!mint || !creator) {
      return res.status(400).json({ error: 'mint and creator are required for signature binding' });
    }
    
    // Validate pubkeys
    try {
      new PublicKey(mint);
      new PublicKey(creator);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid mint or creator public key' });
    }
    
    // Step 1: Canonicalize the URL
    const result = canonicalizeUrl(source_url);
    if (!result) {
      return res.status(400).json({
        error: 'Invalid source URL. Must be a tweet (x.com/.../status/...) or article URL.',
        hint: 'Profile URLs, domains, and keywords are not lockable.',
      });
    }
    
    const { canonicalKey, type, freshness } = result;
    
    // Step 2: Check tweet freshness
    if (type === 'tweet' && !freshness.fresh) {
      return res.status(400).json({
        error: freshness.reason,
        canonical_key: canonicalKey,
        type: 'tweet',
        age_seconds: freshness.ageSec,
      });
    }
    
    // Step 3: Compute source hash
    const sourceHash = crypto.createHash('sha256').update(canonicalKey).digest('hex');
    
    // Step 4: Soft-check Supabase cache (advisory, not authoritative)
    const existingLock = await checkLock(sourceHash);
    if (existingLock) {
      return res.status(409).json({
        error: 'Source likely already claimed (check chain for authority)',
        canonical_key: canonicalKey,
        source_hash: sourceHash,
        locked_by: existingLock.mint,
        locked_at: existingLock.created_at,
      });
    }
    
    // Step 5: Compute image pHash if provided
    let imagePhash = '0000000000000000';
    if (image_base64) {
      const imgBuffer = Buffer.from(image_base64, 'base64');
      const phash = await computePhash(imgBuffer);
      if (phash) {
        imagePhash = phash;
        
        // Check for similar images in existing locks
        const similar = await checkImageSimilarity(imagePhash);
        if (similar) {
          return res.status(409).json({
            error: 'Similar image already locked',
            canonical_key: similar.canonical_key,
            locked_by: similar.mint,
            hamming_distance: similar.hamming_distance,
          });
        }
      }
    }
    
    // Step 6: Build and sign 112-byte payload
    const expiryTimestamp = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SEC;
    const payload = buildSignaturePayload(sourceHash, imagePhash, mint, creator, expiryTimestamp);
    const signature = signPayload(payload);
    
    // Step 7: Return everything the frontend needs
    res.json({
      canonical_key: canonicalKey,
      source_hash: sourceHash,
      image_phash: imagePhash,
      mint,
      creator,
      expiry_timestamp: expiryTimestamp,
      signature,
      signer_pubkey: signerKeypair.publicKey.toBase58(),
    });
    
  } catch (e) {
    console.error('Canonicalize error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lock confirmation — called after successful on-chain deploy
app.post('/confirm-lock', async (req, res) => {
  try {
    const { source_hash, canonical_key, mint, creator, image_phash, tx_sig } = req.body;
    
    if (!source_hash || !canonical_key || !mint || !creator) {
      return res.status(400).json({ error: 'source_hash, canonical_key, mint, and creator are required' });
    }
    
    const saved = await setLock(source_hash, canonical_key, mint, creator, image_phash, tx_sig);
    
    if (saved) {
      res.json({ status: 'locked', source_hash, canonical_key, mint });
    } else {
      res.status(500).json({ error: 'Failed to persist lock. Chain is still the authority.' });
    }
  } catch (e) {
    console.error('Confirm-lock error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if a URL is available
app.get('/check', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  
  const result = canonicalizeUrl(url);
  if (!result) {
    return res.json({ available: false, reason: 'Invalid URL format. Must be a tweet status URL or article URL.' });
  }
  
  const { canonicalKey, type, freshness } = result;
  
  if (type === 'tweet' && !freshness.fresh) {
    return res.json({
      available: false,
      canonical_key: canonicalKey,
      type: 'tweet',
      reason: freshness.reason,
      age_seconds: freshness.ageSec,
      lockable: false,
    });
  }
  
  const sourceHash = crypto.createHash('sha256').update(canonicalKey).digest('hex');
  const lock = await checkLock(sourceHash);
  
  res.json({
    available: !lock,
    canonical_key: canonicalKey,
    source_hash: sourceHash,
    type,
    locked_by: lock?.mint || null,
    age_seconds: freshness?.ageSec || 0,
    lockable: true,
  });
});

// Health check
app.get('/health', async (req, res) => {
  let lockCount = 0;
  let supabaseStatus = 'disconnected';
  
  if (supabase) {
    try {
      const { count, error } = await supabase
        .from('source_locks')
        .select('*', { count: 'exact', head: true });
      
      if (!error) {
        lockCount = count || 0;
        supabaseStatus = 'connected';
      }
    } catch (e) {
      supabaseStatus = 'error';
    }
  }
  
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    signer: signerKeypair.publicKey.toBase58(),
    supabase: supabaseStatus,
    locks: lockCount,
    signature_ttl_sec: SIGNATURE_TTL_SEC,
  });
});

// ── Start ────────────────────────────────────────

app.listen(PORT, () => {
  console.log('========================================');
  console.log('SUMMIT.MOON Anti-Vamp Service');
  console.log(`Port: ${PORT}`);
  console.log(`Signer: ${signerKeypair.publicKey.toBase58()}`);
  console.log(`Supabase: ${SUPABASE_URL ? 'connected' : 'NOT CONFIGURED'}`);
  console.log(`Signature TTL: ${SIGNATURE_TTL_SEC}s`);
  console.log(`Rate limit: ${RATE_LIMIT_MAX} req/min per IP`);
  console.log('========================================');
});
