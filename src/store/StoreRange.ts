import Query, { QueryType } from './Query';
interface StoreRange<T> extends Query<T> {
	start: number;
	count: number;
}

export default StoreRange;

export function rangeFactory<T>(start: number, count: number, serializer?: (range: StoreRange<T>) => string): StoreRange<T> {
	return {
		apply: (data: T[]) => data.slice(start, start + count),
		queryType: QueryType.Range,
		toString() {
			return (serializer || serializeRange)(this);
		},
		start: start,
		count: count
	};
}

function serializeRange(range: StoreRange<any>): string {
	return `range(${range.start}, ${range.count})`;
}
