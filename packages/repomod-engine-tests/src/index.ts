/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
	Repomod,
	buildApi,
	executeRepomod,
} from '@intuita-inc/repomod-engine-api';
import { FacadeFileSystem } from '@intuita-inc/repomod-engine-api';
import { FileSystemManager } from '@intuita-inc/repomod-engine-api';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as fs from 'node:fs';
import j, { Program } from 'jscodeshift';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import hastToBabelAst from '@svgr/hast-util-to-babel-ast';

type Dependencies = Readonly<{
	unified: typeof unified;
	rehypeParse: typeof rehypeParse;
	hastToBabelAst: typeof hastToBabelAst;
}>;

const repomod: Repomod<Dependencies> = {
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
	handleData: async (api, path, __, options) => {
		const index_html_data = options['index_html_data'] ?? '';

		const root = j.withParser('tsx')(`
			import React from 'react';

			interface DocumentProps {
				children: React.ReactNode;
				css: string[]; // array of css import strings
				meta?: string[];
			}

			export const Document = ({ children, css = [] }: DocumentProps) => {
				return '#TODO replace with index.html contents';
			}
		`);

		const dependencies = api.getDependencies();

		const hast = dependencies
			.unified()
			.use(dependencies.rehypeParse)
			.parse(index_html_data);

		hast.children = hast.children.filter(
			(child) => child.type !== 'doctype',
		);

		const program: Program =
			// @ts-expect-error default import issues
			dependencies.hastToBabelAst(hast);

		const jsxRoot = j(program);

		jsxRoot
			.find(j.JSXElement, {
				type: 'JSXElement',
				openingElement: {
					type: 'JSXOpeningElement',
					name: {
						type: 'JSXIdentifier',
						name: 'div',
					},
					attributes: [
						{
							type: 'JSXAttribute',
							name: {
								// type: 'JSXIdentifier',
								name: 'id',
							},
							value: {
								// type: 'StringLiteral',
								value: 'redwood-app',
							},
						},
					],
				},
			})
			.replaceWith((node) => ({
				...node.value,
				children: [j.jsxExpressionContainer(j.identifier('children'))],
			}));

		jsxRoot
			.find(j.JSXElement, {
				type: 'JSXElement',
				openingElement: {
					type: 'JSXOpeningElement',
					name: {
						type: 'JSXIdentifier',
						name: 'head',
					},
				},
			})
			.forEach((path) => {
				const toInject = `
				{css.map((cssLinks, index) => {
					return (
						<link
							rel="stylesheet"
							key={\`css-\${index}\`}
							href={\`/\${cssLinks}\`}
						/>
					);
				})}
				`;

				const collection = j(path).find(j.JSXElement).paths();

				const p = collection[collection.length - 1];

				p?.insertAfter(toInject);
			});

		root.find(j.ReturnStatement).replaceWith((node) => {
			const [firstExpression] = program.body;

			if (
				!firstExpression ||
				firstExpression.type !== 'ExpressionStatement'
			) {
				return node;
			}

			return j.returnStatement(firstExpression.expression);
		});

		console.log(root.toSource());

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
const api = buildApi<Dependencies>(ffs, () => ({
	unified,
	rehypeParse,
	hastToBabelAst,
}));

executeRepomod(
	api,
	repomod,
	'/intuita/repomod-engine/packages/repomod-engine-tests/',
	{},
)
	.then((x) => {
		console.log(x);
	})
	.catch((err) => {
		console.error(err);
	});

// export {};
