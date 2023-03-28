import * as fs from 'node:fs';
import * as platformPath from 'node:path';
import { buildHashDigest } from './buildHash';

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
type FacadeEntryHashDigest = string & {
	__FacadeEntryHashDigest: '__FacadeEntryHashDigest';
};

const buildFacadeEntryHashDigest = (
	facadeEntry: FacadeEntry,
): FacadeEntryHashDigest => {
	return buildHashDigest(facadeEntry.path) as FacadeEntryHashDigest;
};

export class FacadeFileSystem {
	private __facadeEntries = new Map<FacadeEntryHashDigest, FacadeEntry>();
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

					const hashDigest = buildFacadeEntryHashDigest(facadeEntry);

					this.__facadeEntries.set(hashDigest, facadeEntry);
				}

				if (entry.isFile()) {
					const facadeEntry: FacadeEntry = {
						kind: 'file',
						path: entryPath,
						level,
					};

					const hashDigest = buildFacadeEntryHashDigest(facadeEntry);

					this.__facadeEntries.set(hashDigest, facadeEntry);
				}
			});
		}

		return this.__facadeEntries.filter(
			(facadeFile) =>
				facadeFile.path.startsWith(path) && facadeFile.level === level,
		);
	}
}
