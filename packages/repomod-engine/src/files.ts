import * as fs from 'node:fs';
import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash';
import { LeftRightHashSetManager } from './leftRightHashSetManager';

interface FacadeFile {
	readonly kind: 'file';
	readonly path: string;
	readonly level: number;
}

interface FacadeDirectory {
	readonly kind: 'directory';
	readonly path: string;
	readonly level: number;
}

type FacadeEntry = FacadeFile | FacadeDirectory;
type PathHashDigest = string & {
	__PathHashDigest: '__PathHashDigest';
};

const buildPathHashDigest = (path: string): PathHashDigest => {
	return buildHashDigest(path) as PathHashDigest;
};

export class FacadeFileSystem {
	private __directoryFiles = new LeftRightHashSetManager<
		PathHashDigest,
		PathHashDigest
	>(new Set());
	private __facadeEntries = new Map<PathHashDigest, FacadeEntry>();
	private __readDirectories = new Set<string>();

	public constructor(private __realFileSystem: typeof fs) {}

	public async readDirectory(
		path: string,
	): Promise<ReadonlyArray<FacadeEntry>> {
		const { dir } = platformPath.parse(path);

		const level = dir.split(platformPath.sep).length;

		if (!this.__readDirectories.has(path)) {
			const stat = this.__realFileSystem.statSync(path, {
				throwIfNoEntry: false,
			});

			if (!stat || !stat.isDirectory()) {
				return [];
			}

			const dirents = this.__realFileSystem.readdirSync(path, {
				withFileTypes: true,
			});

			dirents.forEach((entry) => {
				const entryPath = platformPath.join(path, entry.name);

				if (entry.isDirectory()) {
					const facadeEntry: FacadeEntry = {
						kind: 'directory',
						path: entryPath,
						level,
					};

					const hashDigest = buildPathHashDigest(facadeEntry);

					this.__facadeEntries.set(hashDigest, facadeEntry);
				}

				if (entry.isFile()) {
					const facadeEntry: FacadeEntry = {
						kind: 'file',
						path: entryPath,
						level,
					};

					const hashDigest = buildPathHashDigest(facadeEntry);

					this.__facadeEntries.set(hashDigest, facadeEntry);
				}
			});
		}

		this.__directoryFiles.getRightHashesByLeftHash();

		// return this.__facadeEntries.filter(
		// 	(facadeFile) =>
		// 		facadeFile.path.startsWith(path) && facadeFile.level === level,
		// );
	}
}
