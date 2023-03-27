type Options = Readonly<Record<string, string | undefined>>;

export type CreateFileCommand = Readonly<{
  kind: "createFile";
  path: string;
  options: Options;
}>;

export type DeleteFileCommand = Readonly<{
  kind: "deleteFile";
  path: string;
  options: Options;
}>;

export type MoveFileCommand = Readonly<{
  kind: "moveFile";
  oldPath: string;
  newPath: string;
  options: Options;
}>;

export type CopyFileCommand = Readonly<{
  kind: "copyFile";
  oldPath: string;
  newPath: string;
  options: Options;
}>;

export type HandleDataCommand = Readonly<{
  kind: "handleData";
  path: string;
  options: Options;
}>;

export type FileCommand =
  | CreateFileCommand
  | DeleteFileCommand
  | MoveFileCommand
  | CopyFileCommand
  | HandleDataCommand;

export type HandleDirectoryCommand = Readonly<{
  kind: "handleDirectory";
  path: string;
  options: Options;
}>;

export type HandleFileCommand = Readonly<{
  kind: "handleFile";
  path: string;
  options: Options;
}>;

export type DirectoryCommand = HandleDirectoryCommand | HandleFileCommand;

export type DataCommand =
  | Readonly<{
      kind: "upsertData";
      data: string;
    }>
  | Readonly<{ kind: "noop" }>;

interface PathAPI {
  getDirname(path: string): string; // might throw
  getBasename(path: string): string; // might throw
  joinPaths(...paths: string[]): string; // might throw
}

interface FileAPI extends PathAPI {
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

interface DataAPI extends PathAPI {
  getJSCodeshift(): JSCodeshift;
  getHTMLParser2(): { parseDocument: typeof parseDocument };
}

interface Handler {
  handleDirectory?: (
    api: DirectoryAPI,
    path: string,
    options: Options
  ) => Promise<ReadonlyArray<DirectoryCommand>>;
  handleFile?: (
    api: FileAPI,
    path: string,
    options: Options
  ) => Promise<ReadonlyArray<FileCommand>>;
  handleData?: (
    api: DataAPI,
    path: string,
    data: string,
    options: Options
  ) => Promise<DataCommand>;
}

// export const executeRepomod = (
//   api: API,
//   repomod: Repomod,
//   rootPath: string,
//   options: Options
// ) => {

// };
