interface Query<T, U> {
	apply(data: T[]): U[];
	toString(): string;
	queryType: QueryType;
}

export const enum QueryType {
	Filter,
	Sort,
	Range,
	Compound
}

export class CompoundQuery<T, U> implements Query<T, U> {
	queryType = QueryType.Compound;
	private queries: Query<any, any>[];
	private finalQuery: Query<any, U>;
	private queryStringBuilder: (queries: Query<any, any>[]) => string;

	constructor(query: Query<T, U>, queryStringBuilder?: (queries: Query<any, any>[]) => string) {
		this.finalQuery = query;
		this.queries = [];
		this.queryStringBuilder = queryStringBuilder || (queries => queries.join(' ::: '));
	}

	apply(data: T[]): U[] {
		return this.finalQuery.apply(this.queries.reduce((prev, next) => {
			return next.apply(prev);
		}, data));
	}

	toString(queryStringBuilder?: (queries: Query<any, any>[]) => string) {
		return (queryStringBuilder || this.queryStringBuilder)([ ...this.queries, this.finalQuery ]);
	}

	withQuery<V>(query: Query<U, V>): CompoundQuery<T, V> {
		const isCompound = query instanceof CompoundQuery;
		let queries = [ ...this.queries, this.finalQuery, ...(isCompound ? (<CompoundQuery<any, any>> query).queries : []) ];
		let finalQuery = isCompound ? (<CompoundQuery<any, any>> query).finalQuery : query;
		const newQuery = new CompoundQuery<T, V>(finalQuery);
		newQuery.queries = queries;

		return newQuery;
	}
}

export default Query;
