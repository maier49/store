import Query, { QueryType } from './Query';
import JsonPointer, { createPointer, navigate } from '../patch/JsonPointer';
import { shouldRecurseInto } from '../utils';

interface Select<T extends U, U> extends Query<T, U> {
	readonly properties: U;
}

export default Select;

function buildOperations(obj: any, key?: JsonPointer): Array<(to: any, from: any) => any> {
	if (!key) {
		key = createPointer();
	}
	const value: any = navigate(key, obj);
	if (shouldRecurseInto(value)) {
		return Object.keys(value).reduce((prev, next) => [ ...prev, ...buildOperations(value, key.push(next)) ], []);
	} else {
		return [ (to: any, from: any) => {
			navigate(key.pop(), to)[key.segments().pop()] = navigate(key, from);
			return to;
		} ];
	}
}

export function selectFactory<T extends U, U>(properties: U, serializer?: (select: Select<T, U>) => string): Select<T, U> {
	const performSelection: Array<(to: any, from: any) => any> = buildOperations(properties);
	return {
		properties: properties,
		queryType: QueryType.Select,
		toString(serializeSelect?: ((query: Query<any, any>) => string) | ((select: Select<T, U>) => string)): string {
			return (serializeSelect || serializer || serialize)(this);
		},
		apply: (data: T[]) => data.map(item => <U> performSelection.reduce((prev, next) => next(prev, item), {}))
	};
}

function serialize(select: Select<any, any>) {
	return `Select(${Object.keys(select.properties).join(',')})`;
}
