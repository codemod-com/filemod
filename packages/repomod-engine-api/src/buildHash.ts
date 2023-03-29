import { createHash } from 'crypto';

export const buildHashDigest = (data: string) =>
	createHash('ripemd160').update(data).digest('base64url');
