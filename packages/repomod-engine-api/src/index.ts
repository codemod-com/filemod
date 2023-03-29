import * as platformPath from 'node:path';
import { ExternalFileCommand } from './externalFileCommands.js';
import { FacadeFileSystem } from './files.js';
import { FileSystemManager } from './fileSystemManager.js';

type RSU = Record<string, unknown>;

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

export interface DataAPI<D extends RSU> extends PathAPI {
	getDependencies: () => D;
}

export interface FileAPI<D extends RSU> extends PathAPI, DataAPI<D> {
	readonly isDirectory: (path: string) => boolean;
	readonly exists: (path: string) => boolean;
	// reading directories and files
	readonly readFile: (filePath: string) => Promise<string>;
}

export interface DirectoryAPI<D extends RSU> extends FileAPI<D> {
	readonly readDirectory: (
		directoryPath: string,
	) => Promise<readonly string[]>; // might throw
}

export interface Repomod<D extends RSU> {
	readonly includePatterns?: readonly string[];
	readonly excludePatterns?: readonly string[];
	readonly handleDirectory?: (
		api: DirectoryAPI<D>,
		path: string,
		options: Options,
	) => Promise<readonly DirectoryCommand[]>;
	readonly handleFile?: (
		api: FileAPI<D>,
		path: string,
		options: Options,
	) => Promise<readonly FileCommand[]>;
	readonly handleData?: (
		api: DataAPI<D>,
		path: string,
		data: string,
		options: Options,
	) => Promise<DataCommand>;
}

export interface API<D extends RSU> {
	facadeFileSystem: FacadeFileSystem;
	directoryAPI: DirectoryAPI<D>;
	fileAPI: FileAPI<D>;
	dataAPI: DataAPI<D>;
}

// eslint-disable-next-line @typescript-eslint/ban-types
const defaultHandleDirectory: Repomod<{}>['handleDirectory'] = async (
	api,
	directoryPath,
	options,
) => {
	const commands: DirectoryCommand[] = [];

	const paths = await api.readDirectory(directoryPath);

	for (const path of paths) {
		const directory = api.isDirectory(path);

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

// eslint-disable-next-line @typescript-eslint/ban-types
const defaultHandleFile: Repomod<{}>['handleFile'] = async (_, path, options) =>
	Promise.resolve([
		{
			kind: 'upsertFile',
			path,
			options,
		},
	]);

// eslint-disable-next-line @typescript-eslint/ban-types
const defaultHandleData: Repomod<{}>['handleData'] = async () =>
	Promise.resolve({
		kind: 'noop',
	});

const handleCommand = async <D extends RSU>(
	api: API<D>,
	repomod: Repomod<D>,
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

		const facadeEntry = await api.facadeFileSystem.upsertFacadeDirectory(
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
		api.facadeFileSystem.deleteFile(command.path);
	}

	if (command.kind === 'upsertData') {
		api.facadeFileSystem.upsertData(command.path, command.data);
	}
};

export const buildApi = <D extends RSU>(
	facadeFileSystem: FacadeFileSystem,
	getDependencies: DataAPI<D>['getDependencies'],
): API<D> => {
	const pathAPI: PathAPI = {
		getDirname: (path) => platformPath.dirname(path),
		getBasename: (path) => platformPath.basename(path),
		joinPaths: (...paths) => platformPath.join(...paths),
	};

	const dataAPI: DataAPI<D> = {
		getDependencies,
		...pathAPI,
	};

	const directoryAPI: DirectoryAPI<D> = {
		readDirectory: (path) => facadeFileSystem.readDirectory(path),
		isDirectory: (path) => facadeFileSystem.isDirectory(path),
		exists: (path) => facadeFileSystem.exists(path),
		readFile: (path) => facadeFileSystem.readFile(path),
		...dataAPI,
	};

	const fileAPI: FileAPI<D> = {
		...directoryAPI,
	};

	return {
		directoryAPI,
		facadeFileSystem,
		fileAPI,
		dataAPI,
	};
};

export const executeRepomod = async <D extends RSU>(
	api: API<D>,
	repomod: Repomod<D>,
	path: string,
	options: Options,
): Promise<readonly ExternalFileCommand[]> => {
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

export { FacadeFileSystem, FileSystemManager };
