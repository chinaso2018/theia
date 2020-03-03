/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

// @ts-check
describe('TypeScript', function () {
    this.timeout(15000);

    const { assert } = chai;

    const Uri = require('@theia/core/lib/common/uri');
    const { BrowserMainMenuFactory } = require('@theia/core/lib/browser/menu/browser-menu-plugin');
    const { EditorManager } = require('@theia/editor/lib/browser/editor-manager');
    const { EditorWidget } = require('@theia/editor/lib/browser/editor-widget');
    const { EDITOR_CONTEXT_MENU } = require('@theia/editor/lib/browser/editor-menu');
    const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
    const { MonacoEditor } = require('@theia/monaco/lib/browser/monaco-editor');
    const { HostedPluginSupport } = require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin');
    const { ContextKeyService } = require('@theia/core/lib/browser/context-key-service');
    const { CommandRegistry } = require('@theia/core/lib/common/command');
    const { OpenerService, open } = require('@theia/core/lib/browser/opener-service');
    const { EditorPreviewWidget } = require('@theia/editor-preview/lib/browser/editor-preview-widget');

    /** @type {import('inversify').Container} */
    const container = window['theia'].container;
    const editorManager = container.get(EditorManager);
    const workspaceService = container.get(WorkspaceService);
    const menuFactory = container.get(BrowserMainMenuFactory);
    const pluginService = container.get(HostedPluginSupport);
    const contextKeyService = container.get(ContextKeyService);
    const commands = container.get(CommandRegistry);
    const openerService = container.get(OpenerService);

    const rootUri = new Uri.default(workspaceService.tryGetRoots()[0].uri);
    const serverUri = rootUri.resolve('src-gen/backend/server.js');
    const inversifyUri = rootUri.resolve('../../node_modules/inversify/dts/inversify.d.ts').normalizePath();

    before(async function () {
        await pluginService.load();
        const plugin = pluginService.plugins.find(p => p.model.id === 'vscode.typescript-language-features');
        await pluginService.activatePlugin(plugin.model.id);
    });

    beforeEach(async function () {
        await editorManager.closeAll({ save: false });

    })

    /**
     * @param {Uri.default} uri
     * @param {boolean} preview
     */
    async function openEditor(uri, preview = false) {
        const widget = await open(openerService, uri, { mode: 'activate', preview });
        const editorWidget = widget instanceof EditorPreviewWidget ? widget.editorWidget : widget instanceof EditorWidget ? widget : undefined;
        const editor = MonacoEditor.get(editorWidget);
        // wait till tsserver is running, see:
        // https://github.com/microsoft/vscode/blob/93cbbc5cae50e9f5f5046343c751b6d010468200/extensions/typescript-language-features/src/extension.ts#L98-L103
        await new Promise(resolve => {
            if (contextKeyService.match('typescript.isManagedFile')) {
                resolve();
                return;
            }
            contextKeyService.onDidChange(() => {
                if (contextKeyService.match('typescript.isManagedFile')) {
                    resolve();
                }
            });
        });
        return editor;
    }

    afterEach(async () => {
        await editorManager.closeAll({ save: false });
    });

    it('document formating should be visible and enabled', async () => {
        await openEditor(serverUri);
        const menu = menuFactory.createContextMenu(EDITOR_CONTEXT_MENU);
        const item = menu.items.find(i => i.command === 'editor.action.formatDocument');
        assert.isDefined(item);
        assert.isTrue(item.isVisible);
        assert.isTrue(item.isEnabled);
    });

    describe('reveal definition', function () {
        for (const preview of [false, true]) {
            let from = 'an editor' + (preview ? ' preview' : '');
            it('within ' + from, async function () {
                const editor = await openEditor(serverUri, preview);
                // con|tainer.load(backendApplicationModule);
                editor.getControl().setPosition({ lineNumber: 12, column: 4 });
                assert.equal(editor.getControl().getModel().getWordAtPosition(editor.getControl().getPosition()).word, 'container');

                await commands.executeCommand('editor.action.revealDefinition');

                const activeEditor = MonacoEditor.get(editorManager.activeEditor);
                assert.equal(editorManager.activeEditor.parent instanceof EditorPreviewWidget, preview);
                assert.equal(activeEditor.uri.toString(), serverUri.toString());
                // const |container = new Container();
                const { lineNumber, column } = activeEditor.getControl().getPosition();
                assert.deepEqual({ lineNumber, column }, { lineNumber: 11, column: 7 });
                assert.equal(activeEditor.getControl().getModel().getWordAtPosition({ lineNumber, column }).word, 'container');
            });

            it(`from ${from} to another editor`, async function () {
                await editorManager.open(inversifyUri, { mode: 'open' });

                const editor = await openEditor(serverUri, preview);
                // const { Cont|ainer } = require('inversify');
                editor.getControl().setPosition({ lineNumber: 5, column: 13 });
                assert.equal(editor.getControl().getModel().getWordAtPosition(editor.getControl().getPosition()).word, 'Container');

                await commands.executeCommand('editor.action.revealDefinition');

                const activeEditor = MonacoEditor.getActive(editorManager);
                assert.isFalse(editorManager.activeEditor.parent instanceof EditorPreviewWidget);
                assert.equal(activeEditor.uri.toString(), inversifyUri.toString());
                // export { |Container } from "./container/container";
                const { lineNumber, column } = activeEditor.getControl().getPosition();
                assert.deepEqual({ lineNumber, column }, { lineNumber: 3, column: 10 });
                assert.equal(activeEditor.getControl().getModel().getWordAtPosition({ lineNumber, column }).word, 'Container');
            });

            it(`from ${from} to an editor preview`, async function () {
                const editor = await openEditor(serverUri);
                // const { Cont|ainer } = require('inversify');
                editor.getControl().setPosition({ lineNumber: 5, column: 13 });
                assert.equal(editor.getControl().getModel().getWordAtPosition(editor.getControl().getPosition()).word, 'Container');

                await commands.executeCommand('editor.action.revealDefinition');

                const activeEditor = MonacoEditor.getActive(editorManager);
                assert.isTrue(editorManager.activeEditor.parent instanceof EditorPreviewWidget);
                assert.equal(activeEditor.uri.toString(), inversifyUri.toString());
                // export { |Container } from "./container/container";
                const { lineNumber, column } = activeEditor.getControl().getPosition();
                assert.deepEqual({ lineNumber, column }, { lineNumber: 3, column: 10 });
                assert.equal(activeEditor.getControl().getModel().getWordAtPosition({ lineNumber, column }).word, 'Container');
            });
        }
    });

});
