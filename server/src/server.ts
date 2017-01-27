/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	IPCMessageReader, IPCMessageWriter, Files,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind
} from 'vscode-languageserver';

import * as path from 'path';
import * as fs from 'fs';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites. 
let workspaceRoot: string;
connection.onInitialize((params): InitializeResult => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind
		}
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	lint(change.document);
});

// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	// Revalidate any open text documents
	documents.all().forEach(lint);
});

function trace(message: string, verbose?: string): void {
	connection.console.log(message);
}

let Linter;
async function getLocalLinter() {
	if (Linter) {
		return Linter;
	}

	return Files.resolveModule(workspaceRoot, 'ember-template-lint')
		.then((resolvedModule) => {
			Linter = resolvedModule;
			return Linter;
		}, (error) => {
			connection.console.log('Module ember-template-lint not found!');
			Object.keys(error).forEach((k) => {
				connection.console.log(`${k}: ${error[k]}`);
			});
		});
}

async function lint(textDocument: TextDocument) {
	const configPath = path.join(workspaceRoot, '.template-lintrc.js');
	const configExists = fs.existsSync(configPath);

	if (!configExists) {
		return;
	}

	const linterOptions = {
		configPath
	};

	const TemplateLinter = await getLocalLinter();
	const linter = new TemplateLinter(linterOptions);
	const linterErrors = linter.verify({
		source: textDocument.getText(),
		moduleId: textDocument.uri
	});


	let diagnostics: Diagnostic[] = linterErrors.map((error) => {
		return {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: error.line - 1, character: error.column },
				end: { line: error.line - 1, character: error.column + 1 }
			},
			message: error.message,
			source: 'ember-template-lint'
		}
	});

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Listen on the connection
connection.listen();
