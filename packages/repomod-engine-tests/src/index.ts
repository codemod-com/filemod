/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
	Repomod,
	buildApi,
	executeRepomod,
} from '@intuita-inc/repomod-engine-api';
import { FacadeFileSystem } from '@intuita-inc/repomod-engine-api/dist/files';
import { FileSystemManager } from '@intuita-inc/repomod-engine-api/dist/fileSystemManager';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as htmlparser2 from 'htmlparser2';
import j, { JSXElement } from 'jscodeshift';
import { join } from 'node:path';

const repomod: Repomod = {
	includePatterns: ['**/*.index.html'],
	excludePatterns: ['**/node_modules'],
	handleFile: async (api, path: string, options) => {
		// we process only index.html files here (in this mod)
		if (api.getBasename(path) !== 'index.html') {
			return []; // no commands
		}

		const index_html_path = path;

		const dirname = api.getDirname(index_html_path);
		const document_tsx_path = api.joinPaths(dirname, 'Document.tsx');

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
		const index_html_data = options['index_html_data'] ?? '';

		type Node = {
			// parent: Node | null;
			name: string;
			children: Node[];
		};

		let rootNode: Node | null = null;
		let currentNode: Node | null = null;

		const parser = new htmlparser2.Parser({
			onopentag: (name) => {
				const node: Node = {
					// parent: currentNode,
					name,
					children: [],
				};

				if (currentNode) {
					currentNode.children.push(node);
				}

				currentNode = node;

				if (!rootNode) {
					rootNode = node;
				}

				// if (name === 'html') {

				// 	const jsxElement = j.jsxElement(
				// 		j.jsxOpeningElement(j.jsxIdentifier(name)),
				// 		j.jsxClosingElement(j.jsxIdentifier(name)),
				// 	);

				// 	programPath.value.body.push(
				// 		j.expressionStatement(jsxElement),
				// 	);
				// }
			},
		});
		parser.write(index_html_data);
		parser.end();

		console.log(rootNode);

		const root = j('');
		const programPath = root.find(j.Program).paths()[0]!;

		const printNode = (node: Node): JSXElement => {
			return j.jsxElement(
				j.jsxOpeningElement(j.jsxIdentifier(node.name)),
				j.jsxClosingElement(j.jsxIdentifier(node.name)),
				node.children.map((child) => printNode(child)),
			);
		};

		const rootJsxElement = printNode(rootNode!);

		programPath.value.body.push(j.expressionStatement(rootJsxElement));

		return Promise.resolve({
			kind: 'upsertData',
			path,
			data: root.toSource(),
		});
	},
};

// import { Volume } from 'memfs';

// const vol = Volume.fromJSON({});

// vol.mkdirSync('/test');
// vol.mkdirSync('/a/b/c', { recursive: true });
// vol.writeFileSync('/test/index.html', 'aaa', {});
// vol.writeFileSync('/test/Document.tsx', 'bbb', {});
// vol.writeFileSync('/a/b/c/Document.tsx', 'bbb', {});
// vol.writeFileSync('/a/b/c/index.html', 'bbb', {});

const fileSystemManager = new FileSystemManager(readdir, readFile, stat);
// vol.promises.readdir as any,
// vol.promises.readFile as any,
// vol.promises.stat as any,

const ffs = new FacadeFileSystem(fs, fileSystemManager);
const api = buildApi(ffs, () => ({
	parseDocument: htmlparser2.parseDocument,
}));

executeRepomod(api, repomod, join(__dirname, '..'), {})
	.then((x) => {
		console.log(x);
	})
	.catch((err) => {
		console.error(err);
	});
