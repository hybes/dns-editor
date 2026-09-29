import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dataDir } from './db'

// Passwords are stored as scrypt hashes, and Cloudflare tokens encrypted with AES-256-GCM.
// The encryption key comes from NUXT_TOKEN_KEY (32 bytes, base64). Without it, a key is made
// once and kept in the data directory; setting NUXT_TOKEN_KEY instead keeps a copy of the
// database from being enough to read the tokens.

const scryptAsync = promisify(scrypt)

// OWASP's scrypt minimum is N=2^17 with r=8; 2^15 keeps a sign-in under ~100 ms on a small
// server while staying well above the old defaults. Stored with each hash, so it can change.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 }
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2

export const randomId = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (text) => createHash('sha256').update(text).digest('base64url')

export async function hashPassword(password) {
	const salt = randomBytes(16)
	const hash = await scryptAsync(password, salt, SCRYPT.keylen, { ...SCRYPT, maxmem: SCRYPT_MAXMEM })
	return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export async function verifyPassword(password, stored) {
	const [kind, N, r, p, salt, hash] = String(stored || '').split('$')
	if (kind !== 'scrypt' || !salt || !hash) return false
	const expected = Buffer.from(hash, 'base64url')
	const options = { N: Number(N), r: Number(r), p: Number(p) }
	const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
		...options,
		maxmem: 128 * options.N * options.r * 2
	})
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// A hash to compare against when the username doesn't exist, so a failed sign-in takes as long
// either way and doesn't reveal which usernames are taken.
let decoyHash = null
export async function decoyPasswordHash() {
	decoyHash ||= await hashPassword(randomId())
	return decoyHash
}

let tokenKey = null
function key() {
	if (tokenKey) return tokenKey
	const configured = useRuntimeConfig().tokenKey
	if (configured) {
		tokenKey = Buffer.from(configured, 'base64')
		if (tokenKey.length !== 32) throw new Error('NUXT_TOKEN_KEY must be 32 bytes, base64-encoded')
		return tokenKey
	}
	const file = join(dataDir(), 'token.key')
	if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' })
	tokenKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
	return tokenKey
}

// "v1.<iv>.<tag>.<ciphertext>", all base64url.
export function encryptSecret(text) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key(), iv)
	const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
	return ['v1', iv, cipher.getAuthTag(), data]
		.map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
		.join('.')
}

export function decryptSecret(sealed) {
	const [version, iv, tag, data] = String(sealed || '').split('.')
	if (version !== 'v1') throw new Error('Unknown secret format')
	const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
	decipher.setAuthTag(Buffer.from(tag, 'base64url'))
	return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
