/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Volume, createFsFromVolume } from 'memfs';
import { describe, it } from 'vitest';
import { PathHashDigest, UnifiedFileSystem } from './unifiedFileSystem.js';
import { deepStrictEqual } from 'node:assert';

import { createHash } from 'crypto';

export const buildHashDigest = (data: string) =>
	createHash('ripemd160').update(data).digest('base64url');

describe('unifiedFileSystem', function () {
	it('should get proper file paths', async function () {
		const volume = Volume.fromJSON({
			'/opt/project/a.json': '',
			'/opt/project/package.json': '',
			'/opt/project/script_a.sh': '',
			'/opt/project/README.md': '',
			'/opt/project/README.notmd': '',
		});

		const unifiedFileSystem = new UnifiedFileSystem(
			createFsFromVolume(volume) as any,
			fileSystemManager,
			(path) => buildHashDigest(path) as PathHashDigest,
		);

		const filePaths = await unifiedFileSystem.getFilePaths(
			'/',
			['**/package.json', '**/*.{md,sh}'],
			[],
		);

		deepStrictEqual(filePaths, [
			'/opt/project/script_a.sh',
			'/opt/project/package.json',
			'/opt/project/README.md',
		]);
	});
});
