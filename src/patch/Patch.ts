import { shouldRecurseInto, isEqual } from '../utils';
import { OperationType, Operation, operationFactory } from './Operation';
import { JsonPointer, pathFactory } from './JsonPointer';
export interface Patch {
	operations: Operation[];
	apply: (target: any) => any;
	toString: () => String;
}


function _diff(from: any, to: any, startingPath?: JsonPointer): Operation[] {
	if (!shouldRecurseInto(from) || !shouldRecurseInto(to)) {
		return [];
	}
	startingPath = startingPath || pathFactory();
	const fromKeys = Object.keys(from);
	const toKeys = Object.keys(to);
	const operations: Operation[] = [];

	fromKeys.forEach((key) => {
		if (!isEqual(from[key], to[key])) {
			if (typeof from[key] !== 'undefined' && typeof to[key] === 'undefined') {
				operations.push(operationFactory(OperationType.Remove, startingPath.add(key)));
			} else if (shouldRecurseInto(from[key]) && shouldRecurseInto(to[key])) {
				operations.push(..._diff(from[key], to[key], startingPath.add(key)));
			} else {
				operations.push(operationFactory(OperationType.Replace, startingPath.add(key), to[key], null, from[key]));
			}
		}
	});

	toKeys.forEach((key) => {
		if (typeof from[key] === 'undefined' && typeof to[key] !== 'undefined') {
			operations.push(operationFactory(OperationType.Add, startingPath.add(key), to[key]));
		}
	});

	return operations;
}

export function diff(from: any, to: any): Patch {
	return createPatch(_diff(from, to));
}

export function createPatch(operations: Operation[]) {
	return {
		operations: operations,
		apply: (target: any) => this.operations.reduce((prev: any, next: Operation) => next.apply(prev), target),
		toString() {
			return '[' + this.operations.reduce((prev: string, next: Operation) => {
					if (prev) {
						return prev + ',' + next.toString();
					} else {
						return next.toString();
					}
				}, '') + ']';
		}
	};
}
