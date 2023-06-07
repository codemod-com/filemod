import * as fs from 'node:fs';
import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash.js';
import { LeftRightHashSetManager } from './leftRightHashSetManager.js';
import { glob } from 'glob';
import { ExternalFileCommand } from './externalFileCommands.js';
import { FileSystemManager } from './fileSystemManager.js';

interface UnifiedFile {
	readonly kind: 'file';
	readonly path: string;
}

interface UnifiedDirectory {
	readonly kind: 'directory';
	readonly path: string;
}

type UnifiedEntry = UnifiedFile | UnifiedDirectory;
type PathHashDigest = string & {
	__PathHashDigest: '__PathHashDigest';
};

const buildPathHashDigest = (path: string): PathHashDigest =>
	buildHashDigest(path) as PathHashDigest;

export class UnifiedFileSystem {
	private __directoryFiles = new LeftRightHashSetManager<
		PathHashDigest,
		PathHashDigest
	>(new Set());
	private __entries = new Map<PathHashDigest, UnifiedEntry>();
	private __changes = new Map<PathHashDigest, string | null>();

	public constructor(
		private __realFileSystem: typeof fs,
		private __fileSystemManager: FileSystemManager,
	) {}

	public async upsertUnifiedEntry(
		path: string,
	): Promise<UnifiedEntry | null> {
		const unifiedDirectory = await this.upsertUnifiedDirectory(path);

		if (unifiedDirectory) {
			return unifiedDirectory;
		}

		return this.upsertUnifiedFile(path);
	}

	public async upsertUnifiedDirectory(
		directoryPath: string,
	): Promise<UnifiedEntry | null> {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		if (!this.__entries.has(directoryPathHashDigest)) {
			const stats = await this.__fileSystemManager.promisifiedStat(
				directoryPath,
			);

			if (!stats.isDirectory()) {
				return null;
			}

			const unifiedDirectory: UnifiedDirectory = {
				kind: 'directory',
				path: directoryPath,
			};

			this.__entries.set(directoryPathHashDigest, unifiedDirectory);

			return unifiedDirectory;
		}

		return this.__entries.get(directoryPathHashDigest) ?? null;
	}

	public async upsertUnifiedFile(
		filePath: string,
	): Promise<UnifiedEntry | null> {
		const filePathHashDigest = buildPathHashDigest(filePath);

		if (!this.__entries.has(filePathHashDigest)) {
			const stats = await this.__fileSystemManager.promisifiedStat(
				filePath,
			);

			if (!stats.isFile()) {
				return null;
			}

			const unifiedFile: UnifiedFile = {
				kind: 'file',
				path: filePath,
			};

			this.__entries.set(filePathHashDigest, unifiedFile);

			return unifiedFile;
		}

		return this.__entries.get(filePathHashDigest) ?? null;
	}

	public async readDirectory(
		directoryPath: string,
	): Promise<readonly string[]> {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		const dirents = await this.__fileSystemManager.promisifiedReaddir(
			directoryPath,
			{
				withFileTypes: true,
			},
		);

		dirents.forEach((entry) => {
			const entryPath = platformPath.join(directoryPath, entry.name);
			const pathHashDigest = buildPathHashDigest(entryPath);

			if (entry.isDirectory()) {
				const unifiedEntry: UnifiedEntry = {
					kind: 'directory',
					path: entryPath,
				};

				// TODO check if it's not removed

				this.__directoryFiles.upsert(
					directoryPathHashDigest,
					pathHashDigest,
				);
				this.__entries.set(pathHashDigest, unifiedEntry);
			}

			if (entry.isFile()) {
				const unifiedEntry: UnifiedEntry = {
					kind: 'file',
					path: entryPath,
				};

				// TODO check if it's not removed

				this.__directoryFiles.upsert(
					directoryPathHashDigest,
					pathHashDigest,
				);
				this.__entries.set(pathHashDigest, unifiedEntry);
			}
		});

		const paths: string[] = [];

		this.__directoryFiles
			.getRightHashesByLeftHash(directoryPathHashDigest)
			.forEach((pathHashDigest) => {
				const unifiedEntry = this.__entries.get(pathHashDigest);

				if (unifiedEntry !== undefined) {
					paths.push(unifiedEntry.path);
				}
			});

		return paths;
	}

	public async readFile(path: string): Promise<string> {
		const pathHashDigest = buildPathHashDigest(path);

		const upsertedData = this.__changes.get(pathHashDigest);

		if (upsertedData === undefined) {
			try {
				return await this.__fileSystemManager.promisifiedReadFile(
					path,
					{
						encoding: 'utf8',
					},
				);
			} catch (error) {
				return '';
			}
		}

		if (upsertedData === null) {
			throw new Error('This file has already been deleted');
		}

		return upsertedData;
	}

	public isDirectory(directoryPath: string): boolean {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		return (
			this.__entries.get(directoryPathHashDigest)?.kind === 'directory'
		);
	}

	public exists(directoryPath: string): boolean {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		return this.__entries.has(directoryPathHashDigest);
	}

	public async getFilePaths(
		directoryPath: string,
		includePatterns: readonly string[],
		excludePatterns: readonly string[],
	): Promise<readonly string[]> {
		const twoDimentionalPaths = await Promise.all(
			includePatterns.map((includePattern) =>
				glob(includePattern, {
					absolute: true,
					cwd: directoryPath,
					fs: this.__realFileSystem,
					ignore: excludePatterns.slice(),
				}),
			),
		);

		const paths = new Set(twoDimentionalPaths.flat());

		paths.forEach((path) => {
			const unifiedFile: UnifiedFile = {
				kind: 'file',
				path,
			};

			const pathHashDigest = buildPathHashDigest(path);

			this.__entries.set(pathHashDigest, unifiedFile);
		});

		return Array.from(paths);
	}

	public deleteFile(filePath: string): void {
		const pathHashDigest = buildPathHashDigest(filePath);

		const unifiedFile: UnifiedFile = {
			kind: 'file',
			path: filePath,
		};

		this.__entries.set(pathHashDigest, unifiedFile);
		this.__changes.set(pathHashDigest, null);
	}

	public upsertData(filePath: string, data: string): void {
		const pathHashDigest = buildPathHashDigest(filePath);

		const unifiedFile: UnifiedFile = {
			kind: 'file',
			path: filePath,
		};

		this.__entries.set(pathHashDigest, unifiedFile);

		this.__changes.set(pathHashDigest, data);
	}

	public buildExternalFileCommands(): readonly ExternalFileCommand[] {
		const commands: ExternalFileCommand[] = [];

		this.__changes.forEach((data, hashDigest) => {
			const entry = this.__entries.get(hashDigest);

			if (entry && data === null) {
				commands.push({
					kind: 'deleteFile',
					path: entry.path,
				});
			}

			if (entry && data !== null) {
				commands.push({
					kind: 'upsertFile',
					path: entry.path,
					data,
				});
			}
		});

		return commands;
	}
}
