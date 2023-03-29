import { stat } from 'node:fs/promises';

export class FileSystemManager {
	public constructor(public readonly promisifiedStat: typeof stat) {}
}
