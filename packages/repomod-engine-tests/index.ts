import { Repomod, FileAPI } from '@intuita-inc/repomod-engine-api';
import { FacadeFileSystem } from '@intuita-inc/repomod-engine-api/dist/files';
import { FileSystemManager } from '@intuita-inc/repomod-engine-api/dist/fileSystemManager';

const repomod: Repomod = {
	includePatterns: ['**/*.index.html'],
	handleFile: async (api, path: string, options) => {
		// we process only index.html files here (in this mod)
		if (api.getBasename(path) !== 'index.html') {
			return []; // no commands
		}

		const index_html_path = path;

		const dirname = api.getDirname(index_html_path);
		const document_tsx_path = api.joinPaths(dirname, 'Document.tsx');

		if (!api.exists(document_tsx_path)) {
			return [];
		}

		// this operation will call the file system and cache the file content
		const index_html_data = await api.readFile(path);

		return [
			{
				// here, we mark the index.html file for deletion
				// if another function reads it, this would end up in an error
				// the file will be really deleted only after the mod has finished
				kind: 'deleteFile',
				path: index_html_path,
				options,
			},
			{
				// let's handle the data
				kind: 'upsertFile',
				path: document_tsx_path,
				options: {
					...options,
					index_html_data,
				},
			},
		];
	},
	// this function might not be called at all
	handleData: async (_, path, __, options) => {
		const index_html_data = options.index_html_data ?? '';

		return Promise.resolve({
			kind: 'upsertData',
			path,
			data: index_html_data,
		});
	},
};

import { Volume } from 'memfs';

const vol = Volume.fromJSON({});

vol.mkdirSync('/test');
vol.mkdirSync('/a/b/c', { recursive: true });
vol.writeFileSync('/test/index.html', 'aaa', {});
vol.writeFileSync('/test/Document.tsx', 'bbb', {});
vol.writeFileSync('/a/b/c/Document.tsx', 'bbb', {});
vol.writeFileSync('/a/b/c/index.html', 'bbb', {});

const fileSystemManager = new FileSystemManager(
	vol.promises.readdir as any,
	vol.promises.readFile as any,
	vol.promises.stat as any,
);

const ffs = new FacadeFileSystem(vol as any, fileSystemManager);
const api = buildApi(ffs, () => ({}));

executeRepomod(api, repomod, '/', {})
	.then((x) => {
		console.log(x);
	})
	.catch((err) => {
		console.error(err);
	});
