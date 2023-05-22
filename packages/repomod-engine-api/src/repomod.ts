import { API, DataAPI, DirectoryAPI, FileAPI } from './api.js';
import { ExternalFileCommand } from './externalFileCommands.js';
import {
	Command,
	DataCommand,
	DirectoryCommand,
	FileCommand,
	HandleFileCommand,
} from './internalCommands.js';
import { Options, RSU } from './options.js';

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
			const paths = await api.unifiedFileSystem.getFilePaths(
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

		const unifiedEntry = await api.unifiedFileSystem.upsertUnifiedDirectory(
			command.path,
		);

		if (unifiedEntry === null) {
			return;
		}

		const defaultDirectoryHandler = !repomod.includePatterns
			? defaultHandleDirectory
			: null;
		const handleDirectory =
			repomod.handleDirectory ?? defaultDirectoryHandler;

		if (handleDirectory === null) {
			return;
		}

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
		const unifiedEntry = await api.unifiedFileSystem.upsertUnifiedFile(
			command.path,
		);

		if (unifiedEntry === null) {
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
		const data = await api.unifiedFileSystem.readFile(command.path);

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
		api.unifiedFileSystem.deleteFile(command.path);
	}

	if (command.kind === 'upsertData') {
		api.unifiedFileSystem.upsertData(command.path, command.data);
	}
};

export const executeRepomod = async <D extends RSU>(
	api: API<D>,
	repomod: Repomod<D>,
	path: string,
	options: Options,
): Promise<readonly ExternalFileCommand[]> => {
	const unifiedEntry = await api.unifiedFileSystem.upsertUnifiedEntry(path);

	if (unifiedEntry === null) {
		return [];
	}

	const command: DirectoryCommand = {
		kind:
			unifiedEntry.kind === 'directory'
				? 'handleDirectory'
				: 'handleFile',
		path,
		options,
	};

	await handleCommand(api, repomod, command);

	return api.unifiedFileSystem.buildExternalFileCommands();
};
