import { createHash } from 'crypto';

export const buildHash = (data: string) =>
	createHash('ripemd160').update(data).digest('base64url');
