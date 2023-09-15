import { API, DataAPI, DirectoryAPI, FileAPI } from './api.js';
import { ExternalFileCommand } from './externalFileCommands.js';
import {
	Command,
	DataCommand,
	DirectoryCommand,
	FileCommand,
	FinishCommand,
} from './internalCommands.js';
import { Options, RSU, State } from './options.js';

type DistributedOmit<T, K extends keyof any> = T extends any
	? Pick<T, Exclude<keyof T, K>>
	: never;

export type CallbackService = Readonly<{
	onCommandExecuted?: (
		command: DistributedOmit<Command, 'data' | 'options'>,
	) => void;
	onError?: (path: string, message: string) => void;
}>;

export type HandleDirectory<D extends RSU, S extends State> = (
	api: DirectoryAPI<D>,
	path: string,
	options: Options,
	state: S | null,
) => Promise<readonly DirectoryCommand[]>;

export type HandleFile<D extends RSU, S> = (
	api: FileAPI<D>,
	path: string,
	options: Options,
	state: S | null,
) => Promise<readonly FileCommand[]>;

export type HandleData<D extends RSU, S extends State> = (
	api: DataAPI<D>,
	path: string,
	data: string,
	options: Options,
	state: S | null,
) => Promise<DataCommand>;

export type InitializeState<S extends State> = (
	options: Options,
	previousState: S | null,
) => Promise<S>;

export type HandleFinish<S extends State> = (
	options: Options,
	state: S | null,
) => Promise<FinishCommand>;

export interface Repomod<D extends RSU, S extends State> {
	readonly includePatterns?: readonly string[];
	readonly excludePatterns?: readonly string[];
	readonly handleDirectory?: HandleDirectory<D, S>;
	readonly handleFile?: HandleFile<D, S>;
	readonly handleData?: HandleData<D, S>;
	readonly initializeState?: InitializeState<S>;
	readonly handleFinish?: HandleFinish<S>;
}

// eslint-disable-next-line @typescript-eslint/ban-types
const defaultHandleDirectory: HandleDirectory<any, any> = async (
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
const defaultHandleFile: Repomod<{}, any>['handleFile'] = async (
	_,
	path,
	options,
) =>
	Promise.resolve([
		{
			kind: 'upsertFile',
			path,
			options,
		},
	]);

// eslint-disable-next-line @typescript-eslint/ban-types
const defaultHandleData: Repomod<{}, any>['handleData'] = async () =>
	Promise.resolve({
		kind: 'noop',
	});

const handleCommand = async <D extends RSU, S extends State>(
	api: API<D>,
	repomod: Repomod<D, S>,
	command: Command,
	callbackService: CallbackService,
	state: S | null,
): Promise<void> => {
	if (command.kind === 'handleDirectory') {
		if (repomod.includePatterns && repomod.includePatterns.length > 0) {
			const paths = await api.unifiedFileSystem.getFilePaths(
				command.path,
				repomod.includePatterns,
				repomod.excludePatterns ?? [],
			);

			for (const path of paths) {
				await handleCommand(
					api,
					repomod,
					{
						kind: 'handleFile',
						path,
						options: command.options,
					},
					callbackService,
					state,
				);
			}

			callbackService.onCommandExecuted?.({
				kind: command.kind,
				path: command.path,
			});
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
			state,
		);

		for (const command of commands) {
			await handleCommand(api, repomod, command, callbackService, state);
		}

		callbackService.onCommandExecuted?.({
			kind: command.kind,
			path: command.path,
		});
	}

	if (command.kind === 'handleFile') {
		const unifiedEntry = await api.unifiedFileSystem.upsertUnifiedFile(
			command.path,
		);

		if (unifiedEntry === null) {
			return;
		}

		const handleFile = repomod.handleFile ?? defaultHandleFile;

		try {
			const commands = await handleFile(
				api.fileAPI,
				command.path,
				command.options,
				state,
			);

			for (const command of commands) {
				await handleCommand(
					api,
					repomod,
					command,
					callbackService,
					state,
				);
			}
		} catch (error) {
			callbackService.onError?.(
				command.path,
				error instanceof Error ? error.message : String(error),
			);
		}

		callbackService.onCommandExecuted?.({
			kind: command.kind,
			path: command.path,
		});
	}

	if (command.kind === 'upsertFile') {
		const data = await api.unifiedFileSystem.readFile(command.path);

		const handleData = repomod.handleData ?? defaultHandleData;

		try {
			const dataCommand = await handleData(
				api.dataAPI,
				command.path,
				data,
				command.options,
				state,
			);

			await handleCommand(
				api,
				repomod,
				dataCommand,
				callbackService,
				state,
			);
		} catch (error) {
			callbackService.onError?.(
				command.path,
				error instanceof Error ? error.message : String(error),
			);
		}

		callbackService.onCommandExecuted?.({
			kind: command.kind,
			path: command.path,
		});
	}

	if (command.kind === 'deleteFile') {
		api.unifiedFileSystem.deleteFile(command.path);

		callbackService.onCommandExecuted?.({
			kind: command.kind,
			path: command.path,
		});
	}

	if (command.kind === 'upsertData') {
		api.unifiedFileSystem.upsertData(command.path, command.data);

		callbackService.onCommandExecuted?.({
			kind: command.kind,
			path: command.path,
		});
	}
};

export const executeRepomod = async <D extends RSU, S extends State>(
	api: API<D>,
	repomod: Repomod<D, S>,
	path: string,
	options: Options,
	callbackService: CallbackService,
	state?: S | null,
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

	const previousState = state ?? null;

	const nextState =
		(await repomod.initializeState?.(options, previousState)) ?? null;

	await handleCommand<D, S>(
		api,
		repomod,
		command,
		callbackService,
		nextState,
	);

	const finishCommand = (await repomod.handleFinish?.(
		options,
		nextState,
	)) ?? {
		kind: 'noop',
	};

	if (finishCommand.kind === 'noop') {
		return api.unifiedFileSystem.buildExternalFileCommands();
	}

	return executeRepomod<D, S>(
		api,
		repomod,
		path,
		options,
		callbackService,
		nextState,
	);
};
