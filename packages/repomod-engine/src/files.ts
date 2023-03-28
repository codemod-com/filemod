import * as fs from 'node:fs';
import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash';
import { LeftRightHashSetManager } from './leftRightHashSetManager';
import glob from 'glob';
import { promisify } from 'node:util';
import { ExternalFileCommand } from './externalFileCommands';

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
	private __deletedFiles = new Set<PathHashDigest>();
	private __upsertedFiles = new Map<PathHashDigest, string>();

	public constructor(private __realFileSystem: typeof fs) {}

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
			const stat = this.__realFileSystem.statSync(directoryPath, {
				throwIfNoEntry: false,
			});

			if (!stat || !stat.isDirectory()) {
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
			const stat = this.__realFileSystem.statSync(filePath, {
				throwIfNoEntry: false,
			});

			if (!stat || !stat.isFile()) {
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
	): Promise<ReadonlyArray<string>> {
		const dirents = this.__realFileSystem.readdirSync(directoryPath, {
			withFileTypes: true,
		});

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

		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

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

		if (this.__deletedFiles.has(pathHashDigest)) {
			throw new Error('This file has already been deleted');
		}

		const upsertedData = this.__upsertedFiles.get(pathHashDigest);

		if (upsertedData !== undefined) {
			return upsertedData;
		}

		return this.__realFileSystem.readFileSync(path, { encoding: 'utf8' });
	}

	public async isDirectory(directoryPath: string): Promise<boolean> {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		return (
			this.__facadeEntries.get(directoryPathHashDigest)?.kind ===
			'directory'
		);
	}

	public async exists(directoryPath: string): Promise<boolean> {
		const directoryPathHashDigest = buildPathHashDigest(directoryPath);

		return this.__facadeEntries.has(directoryPathHashDigest);
	}

	public async getFilePaths(
		directoryPath: string,
		includePatterns: ReadonlyArray<string>,
		excludePatterns: ReadonlyArray<string>,
	): Promise<ReadonlyArray<string>> {
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

			this.__deletedFiles.delete(pathHashDigest);
			this.__upsertedFiles.delete(pathHashDigest);
		});

		return paths;
	}

	public async deleteFile(filePath: string): Promise<void> {
		const pathHashDigest = buildPathHashDigest(filePath);

		const facadeFile: FacadeFile = {
			kind: 'file',
			path: filePath,
		};

		this.__facadeEntries.set(pathHashDigest, facadeFile);

		this.__deletedFiles.add(pathHashDigest);
		this.__upsertedFiles.delete(pathHashDigest);
	}

	public async upsertData(filePath: string, data: string): Promise<void> {
		const pathHashDigest = buildPathHashDigest(filePath);

		const facadeFile: FacadeFile = {
			kind: 'file',
			path: filePath,
		};

		this.__facadeEntries.set(pathHashDigest, facadeFile);

		this.__deletedFiles.delete(pathHashDigest);
		this.__upsertedFiles.set(pathHashDigest, data);
	}

	public buildExternalFileCommands(): ReadonlyArray<ExternalFileCommand> {
		const commands: ExternalFileCommand[] = [];

		// TODO make it one structure (string or null) ?
		this.__deletedFiles.forEach((hashDigest) => {
			const entry = this.__facadeEntries.get(hashDigest);

			if (entry) {
				commands.push({
					kind: 'deleteFile',
					path: entry.path,
				});
			}
		});

		return commands;
	}
}
