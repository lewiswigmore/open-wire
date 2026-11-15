import * as vscode from 'vscode';
import type { Gateway } from '../server/gateway';
import { listModels } from '../models';

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'open-wire.sidebar';
	private view?: vscode.WebviewView;
	private refreshVersion = 0;

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

		view.webview.onDidReceiveMessage(async (msg: { type: string; modelId?: unknown }) => {
			switch (msg.type) {
				case 'start': await this.gateway.start(); break;
				case 'stop': await this.gateway.stop(); break;
				case 'restart': await this.gateway.restart(); break;
				case 'refresh': void this.refresh(); break;
				case 'copyUrl': {
					const c = this.gateway.getConfig();
					await vscode.env.clipboard.writeText(`http://${c.host}:${c.port}`);
					vscode.window.showInformationMessage('Server URL copied');
					break;
				}
				case 'copyApiKey':
					await vscode.env.clipboard.writeText(this.gateway.getConfig().apiKey);
					vscode.window.showInformationMessage('API key copied');
					break;
				case 'copyModel':
					if (typeof msg.modelId === 'string') {
						await vscode.env.clipboard.writeText(msg.modelId);
						vscode.window.showInformationMessage('Model ID copied');
					}
					break;
				case 'revealApiKey':
					if (this.gateway.running) {
						this.view?.webview.postMessage({
							type: 'apiKey',
							key: this.gateway.getConfig().apiKey,
						});
					}
					break;
			}
		});
	}

	async refresh(): Promise<void> {
		if (!this.view) return;
		const refreshVersion = ++this.refreshVersion;
		const running = this.gateway.running;
		const stats = this.gateway.getStats();
		const config = this.gateway.getConfig();
		const state = {
			type: 'state',
			running,
			host: config.host,
			port: config.port,
			apiKeyWasGenerated: config.apiKeyWasGenerated,
			models: [] as Awaited<ReturnType<typeof listModels>>,
			modelsLoading: running,
			modelsError: '',
			stats: {
				totalRequests: stats.totalRequests,
				activeRequests: stats.activeRequests,
				uptime: stats.uptimeMs,
			},
		};

		const postState = (models: typeof state.models, modelsLoading: boolean, modelsError = '') => {
			if (refreshVersion !== this.refreshVersion || !this.view) return;
			this.view.webview.postMessage({ ...state, models, modelsLoading, modelsError });
		};

		postState([], running);
		if (!running) return;

		try {
			postState(await listModels(), false);
		} catch (error) {
			postState([], false, error instanceof Error ? error.message : String(error));
		}
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
			<span class="status-label" id="status-label" aria-live="polite">Stopped</span>
		</div>
		<div class="connection-row" id="url-row" hidden>
			<span class="field-label">Endpoint</span>
			<code id="url-text"></code>
			<button class="icon-btn" id="copy-url" type="button" aria-label="Copy endpoint" title="Copy endpoint">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
			</button>
		</div>
		<div class="connection-row" id="key-row" hidden>
			<span class="field-label" id="key-label">API key</span>
			<code class="key-value" id="key-value">Not shown</code>
			<button class="icon-btn" id="reveal-key" type="button" aria-label="Reveal API key" title="Reveal API key">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5c-3.1 0-5.7 1.9-7 4.5 1.3 2.6 3.9 4.5 7 4.5s5.7-1.9 7-4.5c-1.3-2.6-3.9-4.5-7-4.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>
			</button>
			<button class="icon-btn" id="copy-key" type="button" aria-label="Copy API key" title="Copy API key">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
			</button>
			<p class="field-help"><code>Authorization: Bearer &lt;key&gt;</code></p>
		</div>
	</section>

	<section class="actions">
		<button class="btn btn-primary" id="toggle-btn">Start</button>
		<button class="icon-btn" id="restart-btn" type="button" aria-label="Restart server" title="Restart server" hidden>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 6.32 4H12.6a5 5 0 1 1-1.1-1.45L9.5 5.5H15V0l-2.08 2.08A6.97 6.97 0 0 0 8 1Z"/></svg>
		</button>
	</section>

	<section class="stats-section" id="stats-section" hidden aria-label="Server statistics">
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

	<section class="models-section" id="models-section" hidden>
		<div class="section-heading">
			<h2 class="section-title">Models</h2>
			<span id="model-count" class="model-count"></span>
		</div>
		<input class="model-search" id="model-search" type="search" placeholder="Filter models" aria-label="Filter models" autocomplete="off">
		<p class="model-status" id="model-status" role="status" aria-live="polite" hidden></p>
		<button class="icon-btn" id="retry-models" type="button" aria-label="Retry model discovery" title="Retry model discovery" hidden>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 6.32 4H12.6a5 5 0 1 1-1.1-1.45L9.5 5.5H15V0l-2.08 2.08A6.97 6.97 0 0 0 8 1Z"/></svg>
		</button>
		<div class="model-table-head" aria-hidden="true">
			<span>Model</span><span title="Relative price tier">Cost</span><span title="Relative response speed">Speed</span><span></span>
		</div>
		<div class="model-groups" id="model-groups"></div>
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
	--color-success: var(--vscode-testing-iconPassed, #3fb950);
	--color-danger: var(--vscode-testing-iconFailed, #f85149);
	--color-btn-primary-bg: var(--vscode-button-background);
	--color-btn-primary-fg: var(--vscode-button-foreground);
	--color-btn-primary-hover: var(--vscode-button-hoverBackground);
	--color-input-bg: var(--vscode-input-background, var(--vscode-sideBar-background));
	--color-input-border: var(--vscode-input-border, var(--vscode-panel-border));
	--radius: 3px;
	--space-xs: 4px;
	--space-sm: 8px;
	--space-md: 12px;
	--space-lg: 14px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
[hidden] { display: none !important; }

html {
	scrollbar-width: thin;
	scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
}
html::-webkit-scrollbar { width: 6px; height: 6px; }
html::-webkit-scrollbar-track { background: transparent; }
html::-webkit-scrollbar-thumb {
	background: var(--vscode-scrollbarSlider-background);
	border: 2px solid transparent;
	border-radius: 6px;
	background-clip: padding-box;
}
html::-webkit-scrollbar-thumb:hover {
	background-color: var(--vscode-scrollbarSlider-hoverBackground);
}
html::-webkit-scrollbar-thumb:active {
	background-color: var(--vscode-scrollbarSlider-activeBackground);
}

body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size, 13px);
	color: var(--color-fg);
	background: var(--color-bg);
	padding: var(--space-lg);
	line-height: 1.45;
}

section + section { margin-top: var(--space-lg); }

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

.connection-row {
	display: grid;
	grid-template-columns: 68px minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--space-xs) var(--space-sm);
	margin-top: var(--space-xs);
}

.field-label,
.field-help {
	font-size: 11px;
	color: var(--color-fg-muted);
}

.connection-row > code,
.key-value {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 12px;
}

.field-help { grid-column: 2 / -1; }
.field-help code {
	font-family: var(--vscode-editor-font-family, monospace);
	color: var(--color-fg);
}

.icon-btn {
	width: 28px;
	height: 28px;
	background: none;
	border: none;
	color: var(--color-fg-muted);
	cursor: pointer;
	padding: 6px;
	border-radius: var(--radius);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
}
.icon-btn svg { width: 16px; height: 16px; fill: currentColor; }
.icon-btn:hover { color: var(--color-fg); background: var(--vscode-toolbar-hoverBackground); }

.actions {
	display: flex;
	gap: var(--space-sm);
	align-items: center;
}

.btn {
	padding: 4px 10px;
	border-radius: var(--radius);
	border: none;
	cursor: pointer;
	font-size: 13px;
	font-family: inherit;
	font-weight: 500;
	line-height: 19px;
	transition: background 80ms ease;
}

.btn-primary {
	background: var(--color-btn-primary-bg);
	color: var(--color-btn-primary-fg);
}
.btn-primary:hover { background: var(--color-btn-primary-hover); }

.btn-secondary {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
}
.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-small { padding: 2px 8px; font-size: 12px; }

.section-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--color-fg);
}

.section-heading {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	margin-bottom: var(--space-sm);
}

.stat-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: var(--space-md);
}

.stat {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-xs);
}

.stat-value {
	font-size: 13px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.stat-label {
	font-size: 10px;
	color: var(--color-fg-muted);
}

.model-count {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 11px;
	color: var(--color-fg-muted);
}

.model-search {
	width: 100%;
	height: 28px;
	padding: 3px 7px;
	border: 1px solid var(--color-input-border);
	border-radius: var(--radius);
	background: var(--color-input-bg);
	color: var(--color-fg);
	font: inherit;
	font-size: 12px;
	margin-bottom: var(--space-sm);
}
.model-search::placeholder { color: var(--color-fg-muted); }

.model-table-head,
.model-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 30px 38px 28px;
	align-items: center;
	gap: var(--space-xs);
}

.model-table-head {
	color: var(--color-fg-muted);
	font-size: 10px;
	padding: 0 0 var(--space-xs);
}
.model-table-head > :first-child { padding-left: 10px; }
.model-table-head > :not(:first-child) { text-align: center; }

.model-groups { display: flex; flex-direction: column; gap: 2px; }
.model-group > summary {
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	min-height: 28px;
	cursor: pointer;
	list-style: none;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.2px;
}
.model-group > summary::-webkit-details-marker { display: none; }
.model-group > summary::before {
	content: '›';
	color: var(--color-fg-muted);
	font-size: 16px;
	font-weight: 400;
	line-height: 1;
	width: 10px;
}
.model-group[open] > summary::before { content: '⌄'; }
.group-count {
	margin-left: auto;
	font-family: var(--vscode-editor-font-family, monospace);
	font-weight: 400;
	color: var(--color-fg-muted);
}

.model-row {
	min-height: 28px;
}
.model-row > :first-child { padding-left: 10px; }
.model-id {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 11px;
}

.rating {
	text-align: center;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 10px;
	color: var(--color-fg-muted);
}

.model-status {
	font-size: 12px;
	color: var(--color-fg-muted);
	margin: var(--space-xs) 0;
}
.model-status.error { color: var(--color-danger); }

.skeleton-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 30px 38px 28px;
	align-items: center;
	gap: var(--space-xs);
	min-height: 28px;
}
.skeleton-line {
	height: 8px;
	border-radius: 2px;
	background: var(--vscode-input-background, var(--vscode-editor-background, var(--color-bg)));
}
.skeleton-line.short { width: 14px; justify-self: center; }
.skeleton-line.medium { width: 25px; justify-self: center; }

button:focus-visible,
input:focus-visible,
summary:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
	.btn { transition: none; }
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
const keyRow = $('key-row');
const keyLabel = $('key-label');
const keyValue = $('key-value');
const revealKeyBtn = $('reveal-key');
const toggleBtn = $('toggle-btn');
const restartBtn = $('restart-btn');
const statsSection = $('stats-section');
const modelsSection = $('models-section');
const modelCount = $('model-count');
const modelSearch = $('model-search');
const modelStatus = $('model-status');
const retryModelsBtn = $('retry-models');
const modelTableHead = document.querySelector('.model-table-head');
const modelGroups = $('model-groups');
let currentState;
let apiKeyRevealed = false;

toggleBtn.onclick = () => vscode.postMessage({
	type: toggleBtn.textContent === 'Stop' ? 'stop' : 'start'
});
restartBtn.onclick = () => vscode.postMessage({ type: 'restart' });
$('copy-url').onclick = () => vscode.postMessage({ type: 'copyUrl' });
$('copy-key').onclick = () => vscode.postMessage({ type: 'copyApiKey' });
revealKeyBtn.onclick = () => {
	if (apiKeyRevealed) {
		hideApiKey();
	} else {
		vscode.postMessage({ type: 'revealApiKey' });
	}
};
retryModelsBtn.onclick = () => vscode.postMessage({ type: 'refresh' });
modelSearch.addEventListener('input', () => {
	if (currentState) renderModels(currentState);
});
modelGroups.addEventListener('click', event => {
	if (!(event.target instanceof Element)) return;
	const button = event.target.closest('[data-copy-model]');
	if (button) vscode.postMessage({ type: 'copyModel', modelId: button.dataset.copyModel });
});

function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	if (s < 60) return s + 's';
	const m = Math.floor(s / 60);
	if (m < 60) return m + 'm ' + (s % 60) + 's';
	const h = Math.floor(m / 60);
	return h + 'h ' + (m % 60) + 'm';
}

function hideApiKey() {
	apiKeyRevealed = false;
	keyValue.textContent = 'Not shown';
	revealKeyBtn.setAttribute('aria-label', 'Reveal API key');
	revealKeyBtn.title = 'Reveal API key';
}

function render(state) {
	currentState = state;
	const { running, host, port, stats } = state;

	dot.className = 'status-dot' + (running ? ' running' : '');
	statusLabel.textContent = running ? 'Running' : 'Stopped';

	urlRow.hidden = !running;
	keyRow.hidden = !running;
	urlText.textContent = 'http://' + host + ':' + port;
	keyLabel.textContent = state.apiKeyWasGenerated ? 'Session key' : 'API key';
	toggleBtn.textContent = running ? 'Stop' : 'Start';
	toggleBtn.className = running ? 'btn btn-secondary' : 'btn btn-primary';
	restartBtn.hidden = !running;
	statsSection.hidden = !running;
	if (running && stats) {
		$('stat-uptime').textContent = formatUptime(stats.uptime);
		$('stat-total').textContent = stats.totalRequests;
		$('stat-active').textContent = stats.activeRequests;
	}

	modelsSection.hidden = !running;
	if (!running) hideApiKey();
	renderModels(state);
}

function renderModels(state) {
	const models = Array.isArray(state.models) ? state.models : [];
	modelGroups.replaceChildren();
	retryModelsBtn.hidden = true;
	modelStatus.className = 'model-status';
	modelStatus.hidden = false;
	modelSearch.hidden = models.length === 0;
	modelTableHead.hidden = !state.modelsLoading && models.length === 0;
	modelCount.textContent = state.modelsLoading || state.modelsError ? '' : String(models.length);

	if (state.modelsLoading) {
		modelStatus.textContent = 'Loading models';
		for (let i = 0; i < 4; i++) {
			const row = document.createElement('div');
			row.className = 'skeleton-row';
			row.setAttribute('aria-hidden', 'true');
			row.innerHTML = '<span class="skeleton-line"></span><span class="skeleton-line short"></span><span class="skeleton-line medium"></span><span></span>';
			modelGroups.appendChild(row);
		}
		return;
	}

	if (state.modelsError) {
		modelStatus.classList.add('error');
		modelStatus.textContent = state.modelsError;
		retryModelsBtn.hidden = false;
		return;
	}

	if (models.length === 0) {
		modelStatus.textContent = 'No models discovered';
		return;
	}

	const query = modelSearch.value.trim().toLowerCase();
	const filtered = models.filter(model => [
		model.id, model.name, model.family, model.owned_by
	].some(value => typeof value === 'string' && value.toLowerCase().includes(query)));

	if (filtered.length === 0) {
		modelStatus.textContent = 'No matching models';
		return;
	}

	modelStatus.hidden = true;
	const groups = new Map();
	filtered.forEach(model => {
		const prefix = model.id.split('-')[0] || 'other';
		if (!groups.has(prefix)) groups.set(prefix, []);
		groups.get(prefix).push(model);
	});

	Array.from(groups.keys()).sort().forEach(prefix => {
		const group = document.createElement('details');
		group.className = 'model-group';
		group.open = query.length > 0;
		const summary = document.createElement('summary');
		const label = document.createElement('span');
		label.textContent = prefix;
		const count = document.createElement('span');
		count.className = 'group-count';
		count.textContent = groups.get(prefix).length;
		summary.append(label, count);
		group.appendChild(summary);

		groups.get(prefix).forEach(model => {
			group.appendChild(createModelRow(model));
		});
		modelGroups.appendChild(group);
	});
}

function createModelRow(model) {
	const row = document.createElement('div');
	row.className = 'model-row';
	const id = document.createElement('code');
	id.className = 'model-id';
	id.textContent = model.id;
	id.title = model.id;

	const cost = document.createElement('span');
	cost.className = 'rating';
	const costTiers = { low: '$', medium: '$$', high: '$$$' };
	const costTier = costTiers[model.costTier];
	cost.textContent = costTier || '—';
	cost.title = costTier ? 'Relative cost: ' + model.costTier : 'Cost data unavailable';
	cost.setAttribute('aria-label', cost.title);

	const speed = document.createElement('span');
	speed.className = 'rating';
	const speedTiers = { fast: 'FAST', medium: 'MID', slow: 'SLOW' };
	const speedTier = speedTiers[model.speedTier];
	speed.textContent = speedTier || '—';
	speed.title = speedTier ? 'Relative speed: ' + model.speedTier : 'Speed data unavailable';
	speed.setAttribute('aria-label', speed.title);

	const copy = document.createElement('button');
	copy.className = 'icon-btn';
	copy.type = 'button';
	copy.dataset.copyModel = model.id;
	copy.setAttribute('aria-label', 'Copy model ID ' + model.id);
	copy.title = 'Copy model ID';
	copy.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
	row.append(id, cost, speed, copy);
	return row;
}

function revealApiKey(key) {
	apiKeyRevealed = true;
	keyValue.textContent = key;
	revealKeyBtn.setAttribute('aria-label', 'Hide API key');
	revealKeyBtn.title = 'Hide API key';
}

window.addEventListener('message', function(e) {
	if (e.data.type === 'state') render(e.data);
	if (e.data.type === 'apiKey') revealApiKey(e.data.key);
});

// Request initial state
vscode.postMessage({ type: 'refresh' });
`;
}
