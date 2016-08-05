import Query, { QueryType } from './Query';
import JsonPointer, { navigate, pathFactory } from '../patch/JsonPointer';

export interface Sort<T> extends Query<T, T> {}

export function sortFactory<T>(comparatorOrProperty: ((a: T, b: T) => number) | string | JsonPointer, descending?: boolean): Sort<T> {
	const isFunction = typeof comparatorOrProperty === 'function';
	let comparator: (a: T, b: T) => number;

	if (isFunction) {
		comparator = <any> comparatorOrProperty;
	} else {
		let pointer: JsonPointer;
		if (typeof comparatorOrProperty === 'string') {
			pointer = pathFactory(comparatorOrProperty);
		} else {
			pointer = <JsonPointer> comparatorOrProperty;
		}
		comparator = (a: T, b: T) => sortValue(navigate(pointer, a), navigate(pointer, b));
	}

	if (descending) {
		comparator = flip(comparator);
	}
	return {
		apply: (data: T[]) => data.sort(comparator),
		queryType: QueryType.Sort,
		toString() {
			if (isFunction) {
				throw Error('Cannot parse this sort type to an RQL query string');
			}

			return `Sort(${comparatorOrProperty}, ${descending ? '-' : '+'})`;
		}
	};
}

function flip<T>(comparator: (a: T, b: T) => number) {
	return (a: T, b: T) => -1 * comparator(a, b);
}
function sortValue(a: any, b: any) {
	let comparison: number;
	if (a == null && b == null) {
		comparison = 0;
	} else if (a == null && b != null) {
		comparison = -1;
	} else if (b == null && a != null) {
		comparison = 1;
	} else if (a < b) {
		comparison = -1;
	} else if (a > b) {
		comparison = 1;
	} else {
		comparison = 0;
	}
	return comparison;
}
