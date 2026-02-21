import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import { loadConfig, type ServerConfig } from './config';
import { listModels } from '../models';
import { processChatCompletion, processStreamingChatCompletion } from '../routes/chat';

export class Gateway implements vscode.Disposable {
	private server: Server | undefined;
	private config: ServerConfig;
	private activeRequests = 0;
	private rateBucket: number[] = [];
	private disposables: vscode.Disposable[] = [];
	private stats = { totalRequests: 0, startTime: Date.now() };

	private readonly _onDidChangeStatus = new vscode.EventEmitter<void>();
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	constructor(
		private readonly output: vscode.OutputChannel,
		private readonly statusItem: vscode.StatusBarItem,
	) {
		this.config = loadConfig();

		const sub = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openWire.server')) {
				this.config = loadConfig();
				void this.restart();
			}
		});
		this.disposables.push(sub);
	}

	async start(): Promise<void> {
		await this.stop();
		this.config = loadConfig();

		this.server = createServer((req, res) => {
			void this.handleRequest(req, res);
		});

		this.server.on('error', err => this.log(`Server error: ${err.message}`));

		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject);
			this.server!.listen(this.config.port, this.config.host, () => {
				this.server!.removeListener('error', reject);
				resolve();
			});
		});

		const addr = this.server.address() as AddressInfo;
		this.log(`Listening on http://${addr.address}:${addr.port}`);
		this.stats.startTime = Date.now();
		this.updateStatus(true);
		this._onDidChangeStatus.fire();
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		await new Promise<void>((resolve, reject) => {
			this.server!.close(err => (err ? reject(err) : resolve()));
		});
		this.server = undefined;
		this.activeRequests = 0;
		this.updateStatus(false);
		this._onDidChangeStatus.fire();
	}

	async restart(): Promise<void> {
		this.log('Restarting...');
		await this.start();
	}

	get running(): boolean {
		return !!this.server;
	}

	getConfig(): ServerConfig {
		return this.config;
	}

	getStats() {
		return {
			...this.stats,
			uptimeMs: Date.now() - this.stats.startTime,
			activeRequests: this.activeRequests,
		};
	}

	dispose(): void {
		void this.stop();
		for (const d of this.disposables.splice(0)) d.dispose();
		this._onDidChangeStatus.dispose();
	}

	// ── Request handling ──────────────────────────────────────

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		this.setCors(res);
		if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

		// Auth check
		if (this.config.apiKey) {
			const auth = req.headers['authorization'];
			if (!auth || auth !== `Bearer ${this.config.apiKey}`) {
				this.sendError(res, 401, 'Invalid or missing API key');
				return;
			}
		}

		// Rate limiting
		if (!this.checkRateLimit()) {
			this.sendError(res, 429, 'Rate limit exceeded');
			return;
		}

		// Concurrency limit
		if (this.activeRequests >= this.config.maxConcurrentRequests) {
			this.sendError(res, 503, 'Server at capacity');
			return;
		}

		this.activeRequests++;
		this.stats.totalRequests++;

		const timeout = setTimeout(() => {
			if (!res.writableEnded) {
				this.sendError(res, 504, 'Request timeout');
			}
		}, this.config.requestTimeoutSeconds * 1000);

		try {
			await this.route(req, res);
		} catch (err: any) {
			if (!res.headersSent) {
				this.sendError(res, err.status || 500, err.message || 'Internal server error');
			}
		} finally {
			clearTimeout(timeout);
			this.activeRequests--;
		}
	}

	private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const path = url.pathname;
		const method = req.method || 'GET';

		// Health
		if (method === 'GET' && path === '/health') {
			this.sendJson(res, 200, { status: 'ok', uptime: Date.now() - this.stats.startTime });
			return;
		}

		// Models
		if (method === 'GET' && path === '/v1/models') {
			const models = await listModels();
			this.sendJson(res, 200, { object: 'list', data: models });
			return;
		}

		// Single model
		const modelMatch = path.match(/^\/v1\/models\/(.+)$/);
		if (method === 'GET' && modelMatch) {
			const id = decodeURIComponent(modelMatch[1]);
			const models = await listModels();
			const model = models.find(m => m.id === id);
			if (!model) { this.sendError(res, 404, `Model '${id}' not found`); return; }
			this.sendJson(res, 200, model);
			return;
		}

		// Chat completions
		if (method === 'POST' && path === '/v1/chat/completions') {
			const body = await this.readBody(req);
			// Normalise max_completion_tokens
			if (body?.max_completion_tokens && !body?.max_tokens) {
				body.max_tokens = body.max_completion_tokens;
			}
			if (body?.stream === true) {
				await processStreamingChatCompletion(body, this.config, req, res);
			} else {
				const result = await processChatCompletion(body, this.config);
				this.sendJson(res, 200, result);
			}
			return;
		}

		// Completions (legacy — map to chat)
		if (method === 'POST' && path === '/v1/completions') {
			const body = await this.readBody(req);
			const prompt = body?.prompt || '';
			const chatPayload = {
				...body,
				messages: [{ role: 'user', content: Array.isArray(prompt) ? prompt.join('\n') : prompt }],
			};
			if (body?.stream === true) {
				await processStreamingChatCompletion(chatPayload, this.config, req, res);
			} else {
				const result = await processChatCompletion(chatPayload, this.config);
				this.sendJson(res, 200, result);
			}
			return;
		}

		this.sendError(res, 404, `Unknown endpoint: ${method} ${path}`);
	}

	// ── Utilities ─────────────────────────────────────────────

	private checkRateLimit(): boolean {
		const now = Date.now();
		const windowMs = 60_000;
		this.rateBucket = this.rateBucket.filter(t => now - t < windowMs);
		if (this.rateBucket.length >= this.config.rateLimitPerMinute) return false;
		this.rateBucket.push(now);
		return true;
	}

	private async readBody(req: IncomingMessage): Promise<any> {
		const chunks: Buffer[] = [];
		let size = 0;
		const maxSize = 1024 * 1024; // 1MB

		await new Promise<void>((resolve, reject) => {
			req.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxSize) { req.destroy(); reject({ status: 413, message: 'Payload too large' }); return; }
				chunks.push(chunk);
			});
			req.on('end', resolve);
			req.on('error', reject);
		});

		if (chunks.length === 0) return {};
		const raw = Buffer.concat(chunks).toString('utf8').trim();
		if (!raw) return {};
		try { return JSON.parse(raw); }
		catch { throw { status: 400, message: 'Invalid JSON' }; }
	}

	private sendJson(res: ServerResponse, status: number, body: unknown): void {
		if (!res.headersSent) {
			res.writeHead(status, { 'Content-Type': 'application/json' });
		}
		res.end(JSON.stringify(body));
	}

	private sendError(res: ServerResponse, status: number, message: string): void {
		this.sendJson(res, status, {
			error: { message, type: 'api_error', code: status },
		});
	}

	private setCors(res: ServerResponse): void {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
	}

	private updateStatus(running: boolean): void {
		if (running) {
			this.statusItem.text = '$(broadcast) OpenWire';
			this.statusItem.tooltip = `OpenWire — http://${this.config.host}:${this.config.port}`;
		} else {
			this.statusItem.text = '$(circle-slash) OpenWire';
			this.statusItem.tooltip = 'OpenWire — Stopped';
		}
		this.statusItem.show();
	}

	private log(message: string): void {
		const ts = new Date().toISOString();
		this.output.appendLine(`[${ts}] ${message}`);
		if (this.config.enableLogging) {
			console.log(`[OpenWire] ${message}`);
		}
	}
}
