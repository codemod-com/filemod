import * as platformPath from 'node:path';
import { ExternalFileCommand } from './externalFileCommands';
import { FacadeFileSystem } from './files';

type Options = Readonly<Record<string, string | undefined>>;

export interface UpsertFileCommand {
	readonly kind: 'upsertFile';
	readonly path: string;
	readonly options: Options;
}

export interface DeleteFileCommand {
	readonly kind: 'deleteFile';
	readonly path: string;
}

export interface MoveFileCommand {
	readonly kind: 'moveFile';
	readonly oldPath: string;
	readonly newPath: string;
	readonly options: Options;
}

export interface CopyFileCommand {
	readonly kind: 'copyFile';
	readonly oldPath: string;
	readonly newPath: string;
	readonly options: Options;
}

export type FileCommand =
	| UpsertFileCommand
	| DeleteFileCommand
	| MoveFileCommand
	| CopyFileCommand;

export interface HandleDirectoryCommand {
	readonly kind: 'handleDirectory';
	readonly path: string;
	readonly options: Options;
}

export interface HandleFileCommand {
	readonly kind: 'handleFile';
	readonly path: string;
	readonly options: Options;
}

export type DirectoryCommand = HandleDirectoryCommand | HandleFileCommand;

export interface UpsertDataCommand {
	readonly kind: 'upsertData';
	readonly data: string;
	readonly path: string; // TODO we can remove it and add from context at a later stageW
}

export interface NoopCommand {
	readonly kind: 'noop';
}

export type DataCommand = UpsertDataCommand | NoopCommand;

export type Command = DirectoryCommand | FileCommand | DataCommand;

export interface PathAPI {
	readonly getDirname: (path: string) => string; // might throw
	readonly getBasename: (path: string) => string; // might throw
	readonly joinPaths: (...paths: string[]) => string; // might throw
}

interface DataAPI extends PathAPI {
	getDependencies: () => Record<string, unknown>;
}

interface FileAPI extends PathAPI, DataAPI {
	readonly isDirectory: (path: string) => Promise<boolean>;
	readonly exists: (path: string) => Promise<boolean>;

	// reading directories and files
	readonly readFile: (filePath: string) => Promise<string>; // might throw
}

interface DirectoryAPI extends FileAPI {
	readonly readDirectory: (
		directoryPath: string,
	) => Promise<ReadonlyArray<string>>; // might throw
}

export interface Repomod {
	readonly includePatterns?: ReadonlyArray<string>;
	readonly excludePatterns?: ReadonlyArray<string>;
	readonly handleDirectory?: (
		api: DirectoryAPI,
		path: string,
		options: Options,
	) => Promise<ReadonlyArray<DirectoryCommand>>;
	readonly handleFile?: (
		api: FileAPI,
		path: string,
		options: Options,
	) => Promise<ReadonlyArray<FileCommand>>;
	readonly handleData?: (
		api: DataAPI,
		path: string,
		data: string,
		options: Options,
	) => Promise<DataCommand>;
}

export interface API {
	facadeFileSystem: FacadeFileSystem;
	directoryAPI: DirectoryAPI;
	fileAPI: FileAPI;
	dataAPI: DataAPI;
}

const defaultHandleDirectory: Repomod['handleDirectory'] = async (
	api,
	directoryPath,
	options,
) => {
	const commands: DirectoryCommand[] = [];

	const paths = await api.readDirectory(directoryPath);

	for (const path of paths) {
		const directory = await api.isDirectory(path);

		if (directory) {
			commands.push({
				kind: 'handleDirectory',
				path,
				options,
			});
		} else {
			commands.push({
				kind: 'handleFile',
				path,
				options,
			});
		}
	}

	return commands;
};

const defaultHandleFile: Repomod['handleFile'] = async (_, path, options) => {
	return [
		{
			kind: 'upsertFile',
			path,
			options,
		},
	];
};

const defaultHandleData: Repomod['handleData'] = async () => ({
	kind: 'noop',
});

const handleCommand = async (
	api: API,
	repomod: Repomod,
	command: Command,
): Promise<void> => {
	if (command.kind === 'handleDirectory') {
		if (repomod.includePatterns) {
			const paths = await api.facadeFileSystem.getFilePaths(
				command.path,
				repomod.includePatterns,
				repomod.excludePatterns ?? [],
			);

			for (const path of paths) {
				const handleFileCommand: HandleFileCommand = {
					kind: 'handleFile',
					path,
					options: command.options,
				};

				await handleCommand(api, repomod, handleFileCommand);
			}
		}

		const facadeEntry = api.facadeFileSystem.upsertFacadeDirectory(
			command.path,
		);

		if (facadeEntry === null) {
			return;
		}

		const handleDirectory =
			repomod.handleDirectory ?? defaultHandleDirectory;

		const commands = await handleDirectory(
			api.directoryAPI,
			command.path,
			command.options,
		);

		for (const command of commands) {
			await handleCommand(api, repomod, command);
		}
	}

	if (command.kind === 'handleFile') {
		const facadeEntry = await api.facadeFileSystem.upsertFacadeFile(
			command.path,
		);

		if (facadeEntry === null) {
			return;
		}

		const handleFile = repomod.handleFile ?? defaultHandleFile;

		const commands = await handleFile(
			api.fileAPI,
			command.path,
			command.options,
		);

		for (const command of commands) {
			await handleCommand(api, repomod, command);
		}
	}

	if (command.kind === 'upsertFile') {
		const data = await api.facadeFileSystem.readFile(command.path);

		const handleData = repomod.handleData ?? defaultHandleData;

		const dataCommand = await handleData(
			api.dataAPI,
			command.path,
			data,
			command.options,
		);

		await handleCommand(api, repomod, dataCommand);
	}

	if (command.kind === 'deleteFile') {
		await api.facadeFileSystem.deleteFile(command.path);
	}

	if (command.kind === 'upsertData') {
		await api.facadeFileSystem.upsertData(command.path, command.data);
	}
};

export const buildApi = (
	facadeFileSystem: FacadeFileSystem,
	getDependencies: DataAPI['getDependencies'],
): API => {
	const pathAPI: PathAPI = {
		getDirname: (path) => platformPath.dirname(path),
		getBasename: (path) => platformPath.basename(path),
		joinPaths: (...paths) => platformPath.join(...paths),
	};

	const dataAPI: DataAPI = {
		getDependencies,
		...pathAPI,
	};

	const directoryAPI: DirectoryAPI = {
		readDirectory: (path) => facadeFileSystem.readDirectory(path),
		isDirectory: (path) => facadeFileSystem.isDirectory(path),
		exists: (path) => facadeFileSystem.exists(path),
		readFile: (path) => facadeFileSystem.readFile(path),
		...dataAPI,
	};

	const fileAPI: FileAPI = {
		...directoryAPI,
	};

	return {
		directoryAPI,
		facadeFileSystem,
		fileAPI,
		dataAPI,
	};
};

export const executeRepomod = async (
	api: API,
	repomod: Repomod,
	path: string,
	options: Options,
): Promise<ReadonlyArray<ExternalFileCommand>> => {
	const facadeEntry = await api.facadeFileSystem.upsertFacadeEntry(path);

	if (facadeEntry === null) {
		return [];
	}

	const command: DirectoryCommand = {
		kind:
			facadeEntry.kind === 'directory' ? 'handleDirectory' : 'handleFile',
		path,
		options,
	};

	await handleCommand(api, repomod, command);

	return api.facadeFileSystem.buildExternalFileCommands();
};

// tests

const repomod: Repomod = {
	// this function will be called at least for the root directory path
	handleDirectory: async (
		api: DirectoryAPI,
		directoryPath: string,
		options,
	) => {
		// paths contain all immediate file/directory paths within the directory
		const paths = await api.readDirectory(directoryPath);

		// if the directory has child directories, transform them as well
		// this allows us to do thru the entire file system tree
		const commands: DirectoryCommand[] = paths
			.filter((path) => api.isDirectory(path))
			.map((path) => ({
				kind: 'handleDirectory',
				path,
				options,
			}));

		// find a path with a basename "index.html"
		// there will be either one or none
		const index_html_path =
			paths.find((path) => api.getBasename(path) === 'index.html') ??
			null;

		// transform `Document.tsx` only if it's a file and exists
		if (index_html_path !== null && !api.isDirectory(index_html_path)) {
			// const dirname = api.getDirname(index_html_path);
			// // create a sibling path for an `index.html` file
			// const document_tsx_path = api.joinPaths(dirname, 'Document.tsx');

			// const hasDocumentTsxPath = paths.includes(document_tsx_path);

			// if (!hasDocumentTsxPath) {
			commands.push({
				kind: 'handleFile',
				path: index_html_path,
				options,
			});
			// }
		}

		// the directory is processed, now the engine will process the following commands
		return commands;
	},
	// this function might not be called by the engine if no files have been targeted for processing
	handleFile: async (api, path: string, options) => {
		// we process only index.html files here (in this mod)
		if (api.getBasename(path) === 'index.html') {
			return []; // no commands
		}

		const index_html_path = path;

		const dirname = api.getDirname(index_html_path);
		const document_tsx_path = api.joinPaths(dirname, 'Document.tsx');

		if (!(await api.exists(document_tsx_path))) {
			return [];
		}

		// this operation will call the file system and cache the file content
		const index_html_data = await api.readFile(path);

		if (index_html_data == null) {
			return [];
		}

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
	handleData: async (api, path) => {
		if (api.getBasename(path) === 'Document.tsx') {
			return {
				kind: 'noop',
			};
		}

		return {
			kind: 'upsertData',
			path,
			data: 'test',
		};
	},
};

import { Volume } from 'memfs';

const vol = Volume.fromJSON({ '/foo': 'bar' });

const ffs = new FacadeFileSystem(vol as any);
const api = buildApi(ffs, () => ({}));

console.log(executeRepomod(api, repomod, '/', {}));
