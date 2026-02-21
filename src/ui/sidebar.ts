import * as vscode from 'vscode';
import type { Gateway } from '../server/gateway';
import { listModels } from '../models';

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'open-wire.sidebar';
	private view?: vscode.WebviewView;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly gateway: Gateway,
	) {
		gateway.onDidChangeStatus(() => this.refresh());
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.getHtml();

		view.webview.onDidReceiveMessage(async (msg: { type: string }) => {
			switch (msg.type) {
				case 'start': await this.gateway.start(); break;
				case 'stop': await this.gateway.stop(); break;
				case 'restart': await this.gateway.restart(); break;
				case 'refresh': this.refresh(); break;
				case 'copyUrl': {
					const c = this.gateway.getConfig();
					await vscode.env.clipboard.writeText(`http://${c.host}:${c.port}`);
					vscode.window.showInformationMessage('Server URL copied');
					break;
				}
			}
		});
	}

	async refresh(): Promise<void> {
		if (!this.view) return;
		const models = this.gateway.running ? await listModels().catch(() => []) : [];
		const stats = this.gateway.getStats();
		const config = this.gateway.getConfig();

		this.view.webview.postMessage({
			type: 'state',
			running: this.gateway.running,
			host: config.host,
			port: config.port,
			models,
			stats: {
				totalRequests: stats.totalRequests,
				activeRequests: stats.activeRequests,
				uptime: stats.uptimeMs,
			},
		});
	}

	private getHtml(): string {
		const nonce = getNonce();
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
${getStyles()}
</style>
</head>
<body>
<div id="root">
	<section class="status-section">
		<div class="status-row">
			<span class="status-dot" id="dot"></span>
			<span class="status-label" id="status-label">Stopped</span>
		</div>
		<div class="url-row" id="url-row" style="display:none">
			<code id="url-text"></code>
			<button class="icon-btn" id="copy-btn" title="Copy URL">
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
			</button>
		</div>
	</section>

	<section class="actions">
		<button class="btn btn-primary" id="start-btn">Start</button>
		<button class="btn btn-danger" id="stop-btn" style="display:none">Stop</button>
		<button class="btn btn-outline" id="restart-btn" style="display:none">Restart</button>
	</section>

	<section class="stats-section" id="stats-section" style="display:none">
		<h3 class="section-title">Stats</h3>
		<div class="stat-grid">
			<div class="stat">
				<span class="stat-value" id="stat-uptime">0s</span>
				<span class="stat-label">Uptime</span>
			</div>
			<div class="stat">
				<span class="stat-value" id="stat-total">0</span>
				<span class="stat-label">Requests</span>
			</div>
			<div class="stat">
				<span class="stat-value" id="stat-active">0</span>
				<span class="stat-label">Active</span>
			</div>
		</div>
	</section>

	<section class="models-section" id="models-section" style="display:none">
		<h3 class="section-title">Models <span id="model-count" class="model-count"></span></h3>
		<ul class="model-list" id="model-list"></ul>
	</section>
</div>

<script nonce="${nonce}">
${getScript()}
</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function getStyles(): string {
	return `
:root {
	--color-fg: var(--vscode-foreground);
	--color-fg-muted: var(--vscode-descriptionForeground);
	--color-bg: var(--vscode-sideBar-background);
	--color-border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(255,255,255,.1)));
	--color-success: var(--vscode-testing-iconPassed, #3fb950);
	--color-danger: var(--vscode-testing-iconFailed, #f85149);
	--color-btn-primary-bg: var(--vscode-button-background);
	--color-btn-primary-fg: var(--vscode-button-foreground);
	--color-btn-primary-hover: var(--vscode-button-hoverBackground);
	--color-btn-secondary-bg: var(--vscode-button-secondaryBackground);
	--color-btn-secondary-fg: var(--vscode-button-secondaryForeground);
	--color-btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);
	--radius: 6px;
	--space-xs: 4px;
	--space-sm: 8px;
	--space-md: 12px;
	--space-lg: 16px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size, 13px);
	color: var(--color-fg);
	background: var(--color-bg);
	padding: var(--space-lg);
	line-height: 1.5;
}

section + section {
	margin-top: var(--space-lg);
	padding-top: var(--space-lg);
	border-top: 1px solid var(--color-border);
}

.status-row {
	display: flex;
	align-items: center;
	gap: var(--space-sm);
}

.status-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--color-danger);
	flex-shrink: 0;
}

.status-dot.running {
	background: var(--color-success);
}

.status-label {
	font-weight: 600;
	font-size: 14px;
}

.url-row {
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	margin-top: var(--space-xs);
}

.url-row code {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 12px;
	color: var(--color-fg-muted);
}

.icon-btn {
	background: none;
	border: none;
	color: var(--color-fg-muted);
	cursor: pointer;
	padding: 2px;
	border-radius: 3px;
	display: flex;
	align-items: center;
}
.icon-btn:hover { color: var(--color-fg); background: var(--color-btn-secondary-bg); }

.actions {
	display: flex;
	gap: var(--space-sm);
}

.btn {
	padding: 5px 14px;
	border-radius: var(--radius);
	border: 1px solid transparent;
	cursor: pointer;
	font-size: 13px;
	font-family: inherit;
	font-weight: 500;
	line-height: 20px;
	transition: background 80ms;
}

.btn-primary {
	background: var(--color-btn-primary-bg);
	color: var(--color-btn-primary-fg);
}
.btn-primary:hover { background: var(--color-btn-primary-hover); }

.btn-danger {
	background: var(--color-danger);
	color: #fff;
}
.btn-danger:hover { opacity: 0.9; }

.btn-outline {
	background: var(--color-btn-secondary-bg);
	color: var(--color-btn-secondary-fg);
}
.btn-outline:hover { background: var(--color-btn-secondary-hover); }

.section-title {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--color-fg-muted);
	margin-bottom: var(--space-sm);
}

.stat-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: var(--space-sm);
}

.stat {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.stat-value {
	font-size: 16px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.stat-label {
	font-size: 11px;
	color: var(--color-fg-muted);
}

.model-list {
	list-style: none;
}

.model-item {
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-xs) 0;
}

.model-item + .model-item {
	border-top: 1px solid var(--color-border);
}

.model-id {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 12px;
	word-break: break-all;
}

.model-group-label {
	font-size: 11px;
	font-weight: 600;
	color: var(--color-fg-muted);
	text-transform: uppercase;
	letter-spacing: 0.3px;
	padding: var(--space-sm) 0 var(--space-xs) 0;
}

.model-group-label:first-child {
	padding-top: 0;
}

.model-count {
	font-size: 11px;
	color: var(--color-fg-muted);
	margin-left: auto;
}

.empty {
	color: var(--color-fg-muted);
	font-size: 12px;
	font-style: italic;
}
`;
}

function getScript(): string {
	return `
const vscode = acquireVsCodeApi();

const $ = (id) => document.getElementById(id);
const dot = $('dot');
const statusLabel = $('status-label');
const urlRow = $('url-row');
const urlText = $('url-text');
const startBtn = $('start-btn');
const stopBtn = $('stop-btn');
const restartBtn = $('restart-btn');
const statsSection = $('stats-section');
const modelsSection = $('models-section');
const modelList = $('model-list');

startBtn.onclick = () => vscode.postMessage({ type: 'start' });
stopBtn.onclick = () => vscode.postMessage({ type: 'stop' });
restartBtn.onclick = () => vscode.postMessage({ type: 'restart' });
$('copy-btn').onclick = () => vscode.postMessage({ type: 'copyUrl' });

function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	if (s < 60) return s + 's';
	const m = Math.floor(s / 60);
	if (m < 60) return m + 'm ' + (s % 60) + 's';
	const h = Math.floor(m / 60);
	return h + 'h ' + (m % 60) + 'm';
}

function render(state) {
	const { running, host, port, models, stats } = state;

	dot.className = 'status-dot' + (running ? ' running' : '');
	statusLabel.textContent = running ? 'Running' : 'Stopped';

	urlRow.style.display = running ? 'flex' : 'none';
	urlText.textContent = 'http://' + host + ':' + port;

	startBtn.style.display = running ? 'none' : '';
	stopBtn.style.display = running ? '' : 'none';
	restartBtn.style.display = running ? '' : 'none';

	statsSection.style.display = running ? '' : 'none';
	if (running && stats) {
		$('stat-uptime').textContent = formatUptime(stats.uptime);
		$('stat-total').textContent = stats.totalRequests;
		$('stat-active').textContent = stats.activeRequests;
	}

	modelsSection.style.display = running ? '' : 'none';
	$('model-count').textContent = (models && models.length > 0) ? '(' + models.length + ')' : '';
	modelList.innerHTML = '';
	if (running && models && models.length > 0) {
		// Group models by vendor prefix (claude, gpt, gemini, etc.)
		var groups = {};
		models.forEach(function(m) {
			var prefix = m.id.split('-')[0] || 'other';
			if (!groups[prefix]) groups[prefix] = [];
			groups[prefix].push(m);
		});
		var order = Object.keys(groups).sort();
		order.forEach(function(prefix) {
			var label = document.createElement('li');
			label.className = 'model-group-label';
			label.innerHTML = escapeHtml(prefix) + ' <span class="model-count">' + groups[prefix].length + '</span>';
			modelList.appendChild(label);
			groups[prefix].forEach(function(m) {
				var li = document.createElement('li');
				li.className = 'model-item';
				li.innerHTML = '<span class="model-id">' + escapeHtml(m.id) + '</span>';
				modelList.appendChild(li);
			});
		});
	} else if (running) {
		var li = document.createElement('li');
		li.className = 'empty';
		li.textContent = 'No models discovered';
		modelList.appendChild(li);
	}
}

function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

window.addEventListener('message', function(e) {
	if (e.data.type === 'state') render(e.data);
});

// Request initial state
vscode.postMessage({ type: 'refresh' });
`;
}
