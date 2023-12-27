import { Volume, createFsFromVolume } from 'memfs';
import { describe, it } from 'vitest';
import {
	GlobArguments,
	PathHashDigest,
	UnifiedEntry,
	UnifiedFileSystem,
} from './unifiedFileSystem.js';
import { deepStrictEqual } from 'node:assert';
import { glob } from 'glob';

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

		const ifs = createFsFromVolume(volume);

		const getUnifiedEntry = async (path: string): Promise<UnifiedEntry> => {
			const stat = await ifs.promises.stat(path);

			if (stat.isDirectory()) {
				return {
					kind: 'directory',
					path,
				};
			}

			if (stat.isFile()) {
				return {
					kind: 'file',
					path,
				};
			}

			throw new Error(
				`The entry ${path} is neither a directory nor a file`,
			);
		};

		const buildPathHashDigest = (path: string) =>
			buildHashDigest(path) as PathHashDigest;

		const globWrapper = (globArguments: GlobArguments) => {
			return glob(globArguments.includePatterns.slice(), {
				absolute: globArguments.absolute,
				cwd: globArguments.currentWorkingDirectory,
				ignore: globArguments.excludePatterns.slice(),
				// @ts-expect-error type mismatch
				fs: ifs,
				withFileTypes: false,
			});
		};

		const unifiedFileSystem = new UnifiedFileSystem(
			buildPathHashDigest,
			getUnifiedEntry,
			globWrapper,
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
