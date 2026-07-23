import { Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * AES-256-GCM envelope encryption for store credentials, webhook secrets and
 * payout details. Stored as Bytes = [iv(12) | authTag(16) | ciphertext].
 */
@Injectable()
export class CryptoService {
  private key(): Buffer<ArrayBuffer> {
    const raw = process.env.ENCRYPTION_KEY
    // In production this must be a 64-char hex string (32 random bytes).
    // The startup guard in main.ts ensures it is always provided.
    if (!raw) throw new Error('ENCRYPTION_KEY env var is required — server startup should have caught this missing value')
    return createHash('sha256').update(raw).digest() // 32 bytes
  }

  encrypt(plaintext: string): Buffer<ArrayBuffer> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), enc])
  }

  decrypt(buf: Buffer): string {
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  }

  /**
   * Versioned text envelope for secrets stored inside JSON columns. Keeping the
   * envelope version in-band allows a later key rotation/data migration without
   * guessing whether a value is ciphertext or a legacy plaintext setting.
   */
  encryptText(plaintext: string): string {
    return `enc:v1:${this.encrypt(plaintext).toString('base64')}`
  }

  decryptText(value: string): string {
    if (!value.startsWith('enc:v1:')) return value
    const encoded = value.slice('enc:v1:'.length)
    if (!encoded) throw new Error('Encrypted value is empty')
    return this.decrypt(Buffer.from(encoded, 'base64'))
  }

  isEncryptedText(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('enc:v1:')
  }
}
