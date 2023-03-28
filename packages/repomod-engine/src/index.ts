import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";

type Options = Readonly<Record<string, string | undefined>>;

export interface UpsertFileCommand {
  readonly kind: "upsertFile";
  readonly path: string;
  readonly options: Options;
}

export interface DeleteFileCommand {
  readonly kind: "deleteFile";
  readonly path: string;
  readonly options: Options;
}

export interface MoveFileCommand {
  readonly kind: "moveFile";
  readonly oldPath: string;
  readonly newPath: string;
  readonly options: Options;
}

export interface CopyFileCommand {
  readonly kind: "copyFile";
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
  readonly kind: "handleDirectory";
  readonly path: string;
  readonly options: Options;
}

export interface HandleFileCommand {
  readonly kind: "handleFile";
  readonly path: string;
  readonly options: Options;
}

export type DirectoryCommand = HandleDirectoryCommand | HandleFileCommand;

export interface ExportDataCommand {
  readonly kind: "upsertData";
  readonly data: string;
}

export interface NoopCommand {
  readonly kind: "noop";
}

export type DataCommand = ExportDataCommand | NoopCommand;

export interface PathAPI {
  readonly getDirname: (path: string) => string; // might throw
  readonly getBasename: (path: string) => string; // might throw
  readonly joinPaths: (...paths: string[]) => string; // might throw
}

interface DataAPI extends PathAPI {
  getDependencies: () => Record<string, unknown>;
}

interface FileAPI extends PathAPI, DataAPI {
  // patterns and paths
  readonly includePatterns: ReadonlyArray<string>;
  readonly excludePatterns: ReadonlyArray<string>;

  readonly isDirectory: (path: string) => boolean; // might throw
  readonly exists: (path: string) => Promise<boolean>;

  // reading directories and files
  readonly readFile: (filePath: string) => Promise<string>; // might throw
}

interface DirectoryAPI extends FileAPI {
  readonly readDirectory: (
    directoryPath: string
  ) => Promise<ReadonlyArray<string>>; // might throw
  readonly getFilePaths: (
    directoryPath: string,
    includePatterns: ReadonlyArray<string>,
    excludePatterns: ReadonlyArray<string>
  ) => Promise<ReadonlyArray<string>>;
}

export interface Repomod {
  readonly handleDirectory?: (
    api: DirectoryAPI,
    path: string,
    options: Options
  ) => Promise<ReadonlyArray<DirectoryCommand>>;
  readonly handleFile?: (
    api: FileAPI,
    path: string,
    options: Options
  ) => Promise<ReadonlyArray<FileCommand>>;
  readonly handleData?: (
    api: DataAPI,
    path: string,
    data: string,
    options: Options
  ) => Promise<DataCommand>;
}

export interface API {
  fileSystem: typeof fs;
  promisifiedFileSystem: typeof fsPromises;
  directoryAPI: DirectoryAPI;
  fileAPI: FileAPI;
}

const defaultHandleDirectory: Repomod["handleDirectory"] = async (
  api,
  directoryPath,
  options
) => {
  const filePaths = await api.getFilePaths(
    directoryPath,
    api.includePatterns,
    api.excludePatterns
  );

  return filePaths.map((path) => ({
    kind: "handleFile",
    path,
    options,
  }));
};

const defaultHandleFile: Repomod["handleFile"] = async (
  _,
  path,
  options
) => {
  return [
    {
      kind: "upsertFile",
      path,
      options,
    },
  ];
};

const handleDirectoryCommand = (directoryCommand: DirectoryCommand) {
  if (directoryCommand.kind === "handleDirectory") {
    
  }
}

export const executeRepomod = async (
  api: API,
  repomod: Repomod,
  rootPath: string,
  options: Options
) => {
  const stat = api.fileSystem.statSync(rootPath, { throwIfNoEntry: false });

  if (stat === undefined) {
    return [];
  }

  if (stat.isDirectory()) {
    const handleDirectory = repomod.handleDirectory ?? defaultHandleDirectory;

    const commands = await handleDirectory(api.directoryAPI, rootPath, options);

    // TODO commands
  }

  if (stat.isFile()) {
    const handleFile = repomod.handleFile ?? defaultHandleFile;

    const commands = await handleFile(api.fileAPI, rootPath, options);
  }
};

