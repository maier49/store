import WeakMap from 'dojo-shim/WeakMap';
import compose from 'dojo-compose/compose';

export interface Query<T, U> {
	apply(data: T[]): U[];
	toString(querySerializer?: (query: Query<any, any>) => string): string;
	incremental?: boolean;
	queryType: QueryType;
}

export interface CompoundQuery<T, U> extends Query<T, U> {
	withQuery: <V>(query: Query<U, V>) => CompoundQuery<T, V>;
}

export const enum QueryType {
	Filter,
	Sort,
	Range,
	Select,
	Compound
}

export interface QueryOptions<T, U> {
	query: Query<any, U>;
	queryStringBuilder?: (query: CompoundQuery<any, any>) => string;
}

interface QueryState<T, U> {
	queries: Query<any, any>[];
	finalQuery: Query<any, U>;
	queryStringBuilder: (query: CompoundQuery<any, any>) => string;
}

const instanceStateMap = new WeakMap<Query<{}, {}>, QueryState<{}, {}>>();

// this used to belong to CompoundQuery, but it is never used. Keep it for now.
// function getQueryTypes<T, U>(instance: Query<T, U>) {
// 	const state = instanceStateMap.get(instance);
// 	const queryTypes = new Set<QueryType>();
// 	[ ...state.queries, state.finalQuery ].forEach(function(query: Query<any, any>) {
// 		return queryTypes.add(query.queryType);
// 	});
// 	return queryTypes;
// }

const createCompoundQuery = compose<CompoundQuery<{}, {}>, QueryOptions<{}, {}>>({
	queryType: QueryType.Compound,

	apply(this: Query<{}, {}>, data: {}[]): {}[] {
		const state = instanceStateMap.get(this);
		return state.finalQuery.apply(state.queries.reduce(function(prev, next) {
			return next.apply(prev);
		}, data));
	},

	withQuery<V>(this: Query<{}, {}>, query: Query<{}, V>): CompoundQuery<{}, {}> {
		const state = instanceStateMap.get(this);
		const isCompound = query.queryType === QueryType.Compound;

		const compundQuery = query as CompoundQuery<{}, V>;
		let queries = [ ...state.queries, state.finalQuery, ...(isCompound ? instanceStateMap.get(compundQuery).queries : []) ];
		let finalQuery = isCompound ? instanceStateMap.get(compundQuery).finalQuery : query;
		const newQuery = createCompoundQuery({ query: finalQuery });

		const newQueryState = instanceStateMap.get(newQuery);
		newQueryState.queries = queries;

		return newQuery;
	},

	toString(this: Query<{}, {}>, querySerializer?: ((query: Query<any, any>) => string) | ((query: CompoundQuery<any, any>) => string)): string {
		const state = instanceStateMap.get(this);
		return ( querySerializer || state.queryStringBuilder)(this);
	},

	get incremental(this: Query<{}, {}>) {
		const state = instanceStateMap.get(this);
		return [ ...state.queries, state.finalQuery ].every(function(query: Query<any, any>) {
			return query.incremental;
		});
	}
}, function<T, U>(instance: Query<T, U>, options: QueryOptions<T, U>) {

	instanceStateMap.set(instance, {
		finalQuery: options.query,
		queries: [],
		queryStringBuilder: options.queryStringBuilder || function(query) {
			const state = instanceStateMap.get(query);
			return [ ...state.queries, state.finalQuery ].join('&');
		}
	});
});

export default createCompoundQuery;
