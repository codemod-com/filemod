import * as fs from 'node:fs';

import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash';
import { LeftRightHashSetManager } from './leftRightHashSetManager';
import glob from 'glob';
import { promisify } from 'node:util';
import { ExternalFileCommand } from './externalFileCommands';
import { FileSystemManager } from './fileSystemManager';

const promisifiedGlob = promisify(glob);

interface FacadeFile {
	readonly kind: 'file';
	readonly path: string;
}

interface FacadeDirectory {
	readonly kind: 'directory';
	readonly path: string;
}

type FacadeEntry = FacadeFile | FacadeDirectory;
type PathHashDigest = string & {
	__PathHashDigest: '__PathHashDigest';
};

const buildPathHashDigest = (path: string): PathHashDigest =>
	buildHashDigest(path) as PathHashDigest;

export class FacadeFileSystem {
	private __directoryFiles = new LeftRightHashSetManager<
		PathHashDigest,
		PathHashDigest
	>(new Set());
	private __facadeEntries = new Map<PathHashDigest, FacadeEntry>();
	private __changes = new Map<PathHashDigest, string | null>();

	public constructor(
		private __realFileSystem: typeof fs,
		private __fileSystemManager: FileSystemManager,
	) {}

	public async upsertFacadeEntry(path: string): Promise<FacadeEntry | null> {
		const facadeDirectory = await this.upsertFacadeDirectory(path);

		if (facadeDirectory) {
			return facadeDirectory;
		}

		return this.upsertFacadeFile(path);
	}

	public async upsertFacadeDirectory(
		directoryPath: string,
	): Promise<FacadeEntry | null> {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		if (!this.__facadeEntries.has(directoryPathHashDigest)) {
			const stats = await this.__fileSystemManager.promisifiedStat(
				directoryPath,
			);

			if (!stats.isDirectory()) {
				return null;
			}

			const facadeDirectory: FacadeDirectory = {
				kind: 'directory',
				path: directoryPath,
			};

			this.__facadeEntries.set(directoryPathHashDigest, facadeDirectory);

			return facadeDirectory;
		}

		return this.__facadeEntries.get(directoryPathHashDigest) ?? null;
	}

	public async upsertFacadeFile(
		filePath: string,
	): Promise<FacadeEntry | null> {
		const filePathHashDigest = buildPathHashDigest(filePath);

		if (!this.__facadeEntries.has(filePathHashDigest)) {
			const stats = await this.__fileSystemManager.promisifiedStat(
				filePath,
			);

			if (!stats.isFile()) {
				return null;
			}

			const facadeFile: FacadeFile = {
				kind: 'file',
				path: filePath,
			};

			this.__facadeEntries.set(filePathHashDigest, facadeFile);

			return facadeFile;
		}

		return this.__facadeEntries.get(filePathHashDigest) ?? null;
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
				const facadeEntry: FacadeEntry = {
					kind: 'directory',
					path: entryPath,
				};

				// TODO check if it's not removed

				this.__directoryFiles.upsert(
					directoryPathHashDigest,
					pathHashDigest,
				);
				this.__facadeEntries.set(pathHashDigest, facadeEntry);
			}

			if (entry.isFile()) {
				const facadeEntry: FacadeEntry = {
					kind: 'file',
					path: entryPath,
				};

				// TODO check if it's not removed

				this.__directoryFiles.upsert(
					directoryPathHashDigest,
					pathHashDigest,
				);
				this.__facadeEntries.set(pathHashDigest, facadeEntry);
			}
		});

		const paths: string[] = [];

		this.__directoryFiles
			.getRightHashesByLeftHash(directoryPathHashDigest)
			.forEach((pathHashDigest) => {
				const facadeEntry = this.__facadeEntries.get(pathHashDigest);

				if (facadeEntry !== undefined) {
					paths.push(facadeEntry.path);
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
			this.__facadeEntries.get(directoryPathHashDigest)?.kind ===
			'directory'
		);
	}

	public exists(directoryPath: string): boolean {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		return this.__facadeEntries.has(directoryPathHashDigest);
	}

	public async getFilePaths(
		directoryPath: string,
		includePatterns: readonly string[],
		excludePatterns: readonly string[],
	): Promise<readonly string[]> {
		const paths = await promisifiedGlob(includePatterns[0] ?? '', {
			absolute: true,
			cwd: directoryPath,
			fs: this.__realFileSystem,
			ignore: excludePatterns,
		});

		paths.forEach((path) => {
			const facadeFile: FacadeFile = {
				kind: 'file',
				path,
			};

			const pathHashDigest = buildPathHashDigest(path);

			this.__facadeEntries.set(pathHashDigest, facadeFile);
		});

		return paths;
	}

	public deleteFile(filePath: string): void {
		const pathHashDigest = buildPathHashDigest(filePath);

		const facadeFile: FacadeFile = {
			kind: 'file',
			path: filePath,
		};

		this.__facadeEntries.set(pathHashDigest, facadeFile);
		this.__changes.set(pathHashDigest, null);
	}

	public upsertData(filePath: string, data: string): void {
		const pathHashDigest = buildPathHashDigest(filePath);

		const facadeFile: FacadeFile = {
			kind: 'file',
			path: filePath,
		};

		this.__facadeEntries.set(pathHashDigest, facadeFile);

		this.__changes.set(pathHashDigest, data);
	}

	public buildExternalFileCommands(): readonly ExternalFileCommand[] {
		const commands: ExternalFileCommand[] = [];

		this.__changes.forEach((data, hashDigest) => {
			const entry = this.__facadeEntries.get(hashDigest);

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
