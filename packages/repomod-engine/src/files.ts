import * as fs from 'node:fs';
import * as platformPath from 'node:path';

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

export class FacadeFileSystem {
	private __facadeEntries: FacadeEntry[] = []; // TODO to be optimized
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
					this.__facadeEntries.push({
						kind: 'directory',
						path: entryPath,
						level,
					});
				}

				if (entry.isFile()) {
					this.__facadeEntries.push({
						kind: 'file',
						path: entryPath,
						level,
					});
				}
			});
		}

		return this.__facadeEntries.filter(
			(facadeFile) =>
				facadeFile.path.startsWith(path) && facadeFile.level === level,
		);
	}
}
