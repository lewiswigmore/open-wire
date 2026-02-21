import * as vscode from 'vscode';
import { Gateway } from './server';
import { SidebarProvider } from './ui/sidebar';

let gateway: Gateway | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('OpenWire');
	const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusItem.command = 'open-wire.toggleServer';
	context.subscriptions.push(output, statusItem);

	gateway = new Gateway(output, statusItem);
	context.subscriptions.push(gateway);

	const sidebar = new SidebarProvider(context.extensionUri, gateway);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('open-wire.startServer', () => gateway!.start()),
		vscode.commands.registerCommand('open-wire.stopServer', () => gateway!.stop()),
		vscode.commands.registerCommand('open-wire.restartServer', () => gateway!.restart()),
		vscode.commands.registerCommand('open-wire.toggleServer', () =>
			gateway!.running ? gateway!.stop() : gateway!.start(),
		),
	);

	const config = gateway.getConfig();
	if (config.autoStart) {
		await gateway.start();
	}
}

export function deactivate(): void {
	gateway?.dispose();
	gateway = undefined;
}
