interface Query<T, U> {
	apply(data: T[]): U[];
	toString(querySerializer?: (query: Query<any, any>) => string): string;
	incremental?: boolean;
	queryType: QueryType;
}

export const enum QueryType {
	Filter,
	Sort,
	Range,
	Select,
	Compound
}

export default Query;

export class CompoundQuery<T, U> implements Query<T, U> {
	queryType = QueryType.Compound;
	private queries: Query<any, any>[];
	private finalQuery: Query<any, U>;
	private queryStringBuilder: (query: CompoundQuery<any, any>) => string;

	constructor(query: Query<T, U>, queryStringBuilder?: (query: CompoundQuery<any, any>) => string) {
		this.finalQuery = query;
		this.queries = [];
		this.queryStringBuilder = queryStringBuilder || function(query) {
				return [ ...query.queries, query.finalQuery ].join('&');
			};
	}

	apply(data: T[]): U[] {
		return this.finalQuery.apply(this.queries.reduce(function(prev, next) {
			return next.apply(prev);
		}, data));
	}

	toString(queryStringBuilder?: ((query: Query<any, any>) => string) | ((query: CompoundQuery<any, any>) => string)): string {
		return (queryStringBuilder || this.queryStringBuilder)(this);
	}

	withQuery<V>(query: Query<U, V>): CompoundQuery<T, V> {
		const isCompound = query instanceof CompoundQuery;
		let queries = [ ...this.queries, this.finalQuery, ...(isCompound ? (<CompoundQuery<any, any>> query).queries : []) ];
		let finalQuery = isCompound ? (<CompoundQuery<any, any>> query).finalQuery : query;
		const newQuery = new CompoundQuery<T, V>(finalQuery);
		newQuery.queries = queries;

		return newQuery;
	}

	get queryTypes() {
		const queryTypes = new Set<QueryType>();
		[ ...this.queries, this.finalQuery ].forEach(function(query: Query<any, any>) {
			return queryTypes.add(query.queryType);
		});
		return queryTypes;
	}

	get incremental() {
		return [ ...this.queries, this.finalQuery ].every(function(query: Query<any, any>) {
			return query.incremental;
		});
	}
}
