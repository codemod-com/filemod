import { Volume } from 'memfs';
import { FileSystemManager } from '../src/fileSystemManager.js';
import { UnifiedFileSystem } from '../src/unifiedFileSystem.js';

describe('unifiedFileSystem', function () {
	it('should x', function () {
		const volume = Volume.fromJSON({
			'/opt/project/package.json': '',
			'/opt/project/pages/script_a.sh': '',
			'/opt/project/pages/README.md': '',
			'/opt/project/pages/README.notmd': '',
		});

		const fileSystemManager = new FileSystemManager(
			volume.promises.readdir as any,
			volume.promises.readFile as any,
			volume.promises.stat as any,
		);
		const unifiedFileSystem = new UnifiedFileSystem(
			volume as any,
			fileSystemManager,
		);
	});
});
