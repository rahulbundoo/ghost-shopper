import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export class TokenCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('SESSION_KEY_INVALID');
    this.key = Buffer.from(key, 'hex');
  }
  encrypt(value: string | undefined, binding: string): string | undefined {
    if (!value) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(binding));
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${bytes.toString('base64url')}`;
  }
  decrypt(value: string | undefined, binding: string): string | undefined {
    if (!value) return value;
    try {
      const parts = value.split(':');
      if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(parts[2]!, 'base64url'),
      );
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[4]!, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('SESSION_DECRYPTION_FAILED');
    }
  }
}
