import * as fs from 'node:fs';
import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash';
import { LeftRightHashSetManager } from './leftRightHashSetManager';

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

					this.__directoryFiles.upsert(
						directoryPathHashDigest,
						pathHashDigest,
					);
					this.__facadeEntries.set(pathHashDigest, facadeEntry);
				}
			});

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
}
