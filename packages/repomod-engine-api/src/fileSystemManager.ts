import type { stat, readdir, readFile } from 'node:fs/promises';

export class FileSystemManager {
	public constructor(
		public readonly promisifiedReaddir: typeof readdir,
		public readonly promisifiedReadFile: typeof readFile,
		public readonly promisifiedStat: typeof stat,
	) {}
}
