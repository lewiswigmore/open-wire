/**
 * Errors that carry an HTTP status so pure modules can signal request problems
 * without depending on the server or vscode layers.
 */
export class RequestError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'RequestError';
		this.status = status;
	}
}

export function badRequest(message: string): RequestError {
	return new RequestError(400, message);
}
