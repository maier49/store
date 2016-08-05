interface JsonPointer {
	segments(): string[];
	toString(): string;
	push(segment: String): JsonPointer;
	pop(): JsonPointer;
}
export default JsonPointer;

export function navigate(path: JsonPointer, target: any) {
	return path.segments().reduce((prev: any, next: string) => prev ? prev[next] : prev, target);
}

function decode(segment: string) {
	return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encode(segment: string) {
	return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function toString(...segments: string[]): string {
	return segments.reduce((prev, next) => prev + '/' + encode(next));
}

export function createPointer(...segments: string[]): JsonPointer {
	return {
		segments: () => segments.map(segment => decode(segment)),
		toString: () => toString(...segments),
		push: (segment: string) => createPointer(...segments.concat(segment)),
		pop: () => createPointer(...segments.slice(0, segments.length - 1))
	};
}
