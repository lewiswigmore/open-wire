import { randomUUID } from 'crypto';
import { badRequest } from './errors';

export interface ParsedToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface ForwardedTool {
	name: string;
	description: string;
	inputSchema: object;
}

export type ToolChoicePlan =
	| { mode: 'none' }
	| { mode: 'auto' }
	| { mode: 'required'; only?: string };

/**
 * Parse XML-style function calls out of model text output.
 * Some models emit this shape instead of a native tool call part.
 */
export function parseXmlToolCalls(text: string): { cleanedText: string; toolCalls: ParsedToolCall[] } {
	const toolCalls: ParsedToolCall[] = [];
	const cleaned = text.replace(
		/<function_calls>\s*([\s\S]*?)<\/function_calls>/g,
		(_match, block: string) => {
			for (const inv of block.matchAll(/<invoke\s+name="([^"]+)">\s*([\s\S]*?)<\/invoke>/g)) {
				const params: Record<string, string> = {};
				for (const p of inv[2].matchAll(/<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g)) {
					params[p[1]] = p[2];
				}
				toolCalls.push({
					id: `call_${randomUUID()}`,
					type: 'function',
					function: { name: inv[1], arguments: JSON.stringify(params) },
				});
			}
			return '';
		},
	);
	return { cleanedText: cleaned.trim(), toolCalls };
}

/** Decide how tool_choice maps onto the VS Code tool mode. */
export function planToolChoice(toolChoice: unknown): ToolChoicePlan {
	if (toolChoice === undefined || toolChoice === null || toolChoice === 'auto') {
		return { mode: 'auto' };
	}
	if (toolChoice === 'none') return { mode: 'none' };
	if (toolChoice === 'required' || toolChoice === 'any') return { mode: 'required' };

	if (typeof toolChoice === 'object') {
		const tc = toolChoice as Record<string, any>;
		const name = tc.function?.name ?? tc.name;
		if (typeof name === 'string' && name) {
			return { mode: 'required', only: name };
		}
		throw badRequest('tool_choice object must specify function.name');
	}

	throw badRequest(
		`Invalid tool_choice "${String(toolChoice)}". Expected "auto", "none", "required", or {"type":"function","function":{"name":"..."}}`,
	);
}

/** Map OpenAI tool definitions onto the VS Code tool shape. */
export function mapTools(rawTools: unknown): ForwardedTool[] {
	if (rawTools === undefined) return [];
	if (!Array.isArray(rawTools)) {
		throw badRequest('tools must be an array');
	}
	return rawTools.map((t: any) => {
		const fn = t?.function || t;
		if (!fn || typeof fn.name !== 'string' || !fn.name) {
			throw badRequest('Each tool must have a function.name');
		}
		return {
			name: fn.name,
			description: fn.description || '',
			inputSchema: fn.parameters || {},
		};
	});
}

/**
 * Apply a tool_choice plan to the mapped tool list.
 * Returns null when no tools should be forwarded at all.
 */
export function applyToolChoice(
	tools: ForwardedTool[],
	plan: ToolChoicePlan,
): { tools: ForwardedTool[]; required: boolean } | null {
	if (plan.mode === 'none') return null;
	if (tools.length === 0) {
		if (plan.mode === 'required') {
			throw badRequest('tool_choice "required" needs at least one tool');
		}
		return null;
	}

	if (plan.mode === 'required' && plan.only) {
		const match = tools.filter(t => t.name === plan.only);
		if (match.length === 0) {
			throw badRequest(`tool_choice names "${plan.only}", which is not in the tools array`);
		}
		return { tools: match, required: true };
	}

	return { tools, required: plan.mode === 'required' };
}
