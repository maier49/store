import JsonPointer, { navigate, pathFactory } from '../patch/JsonPointer';
import { isEqual } from '../utils';
import Query, { QueryType } from './Query';

export type FilterFunction<T> = (data: T[]) => T[];
export type ObjectPointer = JsonPointer | string;

export const enum FilterType {
	LessThan,
	GreaterThan,
	EqualTo,
	DeepEqualTo,
	In,
	Contains,
	NotEqualTo,
	NotDeepEqualTo,
	LessThanOrEqualTo,
	GreaterThanOrEqualTo,
	Matches,
	Custom,
	Compound
}

export const enum BooleanOp {
	And,
	Or
}

export type FilterChainMember<T> = (SimpleFilter<T> | BooleanOp);

export interface SimpleFilter<T> extends Query<T, T> {
	type: FilterType;
	test?: (item: T) => boolean;
	filterChain?: FilterChainMember<T>[];
	path?: ObjectPointer;
	value?: any;
}
export interface BooleanFilter<T> extends SimpleFilter<T> {
	lessThan(path: ObjectPointer, value: number): Filter<T>;
	lessThanOrEqualTo(path: ObjectPointer, value: number): Filter<T>;
	greaterThan(path: ObjectPointer, value: number): Filter<T>;
	greaterThanOrEqualTo(path: ObjectPointer, value: number): Filter<T>;
	matches(path: ObjectPointer, test: RegExp): Filter<T>;
	in<U>(path: ObjectPointer, value: U[]): Filter<T>;
	contains<U>(path: ObjectPointer, value: U): Filter<T>;
	equalTo<U>(path: ObjectPointer, value: U): Filter<T>;
	deepEqualTo<U extends {}>(path: ObjectPointer, value: U): Filter<T>;
	deepEqualTo<U>(path: ObjectPointer, value: U[]): Filter<T>;
	notEqualTo<U>(path: ObjectPointer, value: U): Filter<T>;
	notDeepEqualTo<U extends {}>(path: ObjectPointer, value: U): Filter<T>;
	notDeepEqualTo<U>(path: ObjectPointer, value: U[]): Filter<T>;
	custom(test: (item: T) => boolean): Filter<T>;
}

export interface Filter<T> extends BooleanFilter<T> {
	and(filter: Filter<T>): Filter<T>;
	and(): BooleanFilter<T>;
	or(filter: Filter<T>): Filter<T>;
	or(): BooleanFilter<T>;
}

export default Filter;

function isFilter<T>(filterOrFunction: FilterChainMember<T>): filterOrFunction is Filter<T> {
	return typeof filterOrFunction !== 'function'  && (<any> filterOrFunction).apply;
}

export function filterFactory<T>(serializer?: (filter: Filter<T>) => string): Filter<T> {
	// var subFilters: NestedFilter<T> = subFilters || [];
	let filters: FilterChainMember<T>[] = [];
	serializer = serializer || serializeFilter;

	return filterFactoryHelper(filters, serializer);
}

function filterFactoryHelper<T>(filters: FilterChainMember<T>[], serializer?: (filter: Filter<T>) => string): Filter<T> {
	// Small helpers to abstract common operations for building comparator filters
	// The main helper delegates to the factory, adding and AND operation before the next filter,
	// because by default each filter in a chain will be ANDed with the previous.
	function comparatorFilterHelper(filterType: FilterType, value: any, path?: ObjectPointer): Filter<T> {
		const needsOperator = filters.length > 0 &&
			(filters[filters.length - 1] !== BooleanOp.And && filters[filters.length - 1] !== BooleanOp.Or);
		const newFilters = needsOperator ? [ ...filters, BooleanOp.And, comparatorFactory<T>(filterType, value, path) ] :
			[ ...filters, comparatorFactory<T>(filterType, value, path) ];
		return filterFactoryHelper(newFilters, serializer);
	}

	const filter: Filter<T> = {
		test: item => applyFilterChain(item, filters),
		type: FilterType.Compound,
		apply(data: T[]) {
			return data.filter(this.test);
		},
		filterChain: filters,
		toString() {
			return serializer(this);
		},
		and(newFilter?: Filter<T>) {
			let newFilters: FilterChainMember<T>[] = [];
			if (newFilter) {
				newFilters.push(this, BooleanOp.And, newFilter);
			} else if (filters.length) {
				newFilters.push(...filters, BooleanOp.And);
			}
			return filterFactoryHelper(newFilters, serializer);
		},
		or(newFilter?: Filter<T>) {
			let newFilters: FilterChainMember<T>[] = [];
			if (newFilter) {
				newFilters.push(this, BooleanOp.Or, newFilter);
			} else if (filters.length) {
				newFilters.push(...filters, BooleanOp.Or);
			}
			return filterFactoryHelper(newFilters, serializer);
		},
		lessThan: (path: ObjectPointer, value: number) => comparatorFilterHelper(FilterType.LessThan, value, path),
		lessThanOrEqualTo: (path: ObjectPointer, value: number) => comparatorFilterHelper(FilterType.LessThanOrEqualTo, value, path),
		greaterThan: (path: ObjectPointer, value: number) => comparatorFilterHelper(FilterType.GreaterThan, value, path),
		greaterThanOrEqualTo: (path: ObjectPointer, value: number) => comparatorFilterHelper(FilterType.GreaterThanOrEqualTo, value, path),
		matches: (path: ObjectPointer, value: RegExp) => comparatorFilterHelper(FilterType.Matches, value, path),
		'in': (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.In, value, path),
		contains: (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.Contains, value, path),
		equalTo: (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.EqualTo, value, path),
		deepEqualTo: (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.DeepEqualTo, value, path),
		notEqualTo: (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.NotEqualTo, value, path),
		notDeepEqualTo: (path: ObjectPointer, value: any) => comparatorFilterHelper(FilterType.NotDeepEqualTo, value, path),
		custom: (test: (item: T) => boolean) => comparatorFilterHelper(FilterType.Custom, test),
		queryType: QueryType.Filter
	};

	return filter;
}

function applyFilterChain<T>(item: T, filterChain: FilterChainMember<T>[]): boolean {
	let ordFilterSections: FilterChainMember<T>[][] = [];
	let startOfSlice = 0;
	// Ands have higher precedence, so split into chains of
	// ands between ors.
	filterChain.forEach(function(chainMember, i) {
		if (chainMember === BooleanOp.Or) {
			ordFilterSections.push(filterChain.slice(startOfSlice, i));
			startOfSlice = i + 1;
		}
	});

	if (startOfSlice < filterChain.length) {
		ordFilterSections.push(filterChain.slice(startOfSlice, filterChain.length));
	}

	// These sections are or'd together so only
	// one has to pass
	return ordFilterSections.some(function(filterChain: FilterChainMember<T>[]) {
		// The individual filters are and'd together, so if any
		// fails the whole section fails
		return filterChain.every(function(filterOrAnd: FilterChainMember<T>) {
			if (isFilter(filterOrAnd)) {
				return filterOrAnd.test(item);
			} else {
				return true;
			}
		});
	});
}

function comparatorFactory<T>(operator: FilterType, value: any, path?: ObjectPointer): SimpleFilter<T> {
	path = typeof path === 'string' ? pathFactory(path) : path;
	let test: (property: any) => boolean;
	let type: FilterType;
	let operatorString: string;
	switch (operator) {
		case FilterType.LessThan:
			type = FilterType.LessThan;
			test = property => property < value;
			operatorString = 'lt';
			break;
		case FilterType.LessThanOrEqualTo:
			type = FilterType.LessThanOrEqualTo;
			test = property => property <= value;
			operatorString = 'lte';
			break;
		case FilterType.GreaterThan:
			type = FilterType.GreaterThan;
			test = property => property > value;
			operatorString = 'gt';
			break;
		case FilterType.GreaterThanOrEqualTo:
			type = FilterType.GreaterThanOrEqualTo;
			test = property => property >= value;
			operatorString = 'gte';
			break;
		case FilterType.EqualTo:
			type = FilterType.EqualTo;
			test = property => property === value;
			operatorString = 'eq';
			break;
		case FilterType.NotEqualTo:
			type = FilterType.NotEqualTo;
			test = property => property !== value;
			operatorString = 'ne';
			break;
		case FilterType.DeepEqualTo:
			type = FilterType.DeepEqualTo;
			test = property => isEqual(property, value);
			operatorString = 'eq';
			break;
		case FilterType.NotDeepEqualTo:
			type = FilterType.NotDeepEqualTo;
			test = property => !isEqual(property, value);
			operatorString = 'ne';
			break;
		case FilterType.Contains:
			type = FilterType.Contains;
			test = propertyOrItem => {
				if (Array.isArray(propertyOrItem)) {
					return propertyOrItem.indexOf(value) > -1;
				} else {
					return propertyOrItem && Boolean(propertyOrItem[value]);
				}
			};
			operatorString = 'contains';
			break;
		case FilterType.In:
			type = FilterType.In;
			test = propertyOrItem => Array.isArray(value) && value.indexOf(propertyOrItem) > -1;
			operatorString = 'in';
			break;
		case FilterType.Matches:
			type = FilterType.Matches;
			test = property => value.test(property);
			break;
		case FilterType.Custom:
			type = FilterType.Custom;
			test = value;
			break;
		default:
			return null;
	}
	return {
		test: (item: T) => {
			let propertyValue: any = path ? navigate(<JsonPointer> path, item) : item;
			return test(propertyValue);
		},
		apply: function(data: T[]) {
			return data.filter(this.test);
		},
		toString: function() {
			if (!operatorString) {
				throw Error('Cannot parse this filter type to an RQL query string');
			}
			return `${operatorString}(${path.toString()}, ${JSON.stringify(value)})`;
		},
		path: path,
		value: value,
		type: type,
		queryType: QueryType.Filter
	};
}

//// Default serialization function
function serializeFilter(filter: Filter<any>): string {
	let operator = '&';
	if (filter.filterChain) {
		return filter.filterChain.reduce(function(prev: string, next: FilterChainMember<any>) {
			if (isFilter(next)) {
				const start = next.filterChain ? '(' : '';
				const end = next.filterChain ? ')' : '';
				return prev + (prev ? operator : '') + (prev ? start : '') + next.toString() + (prev ? end : '');
			} else if (next === BooleanOp.And) {
				operator = '&';
				return prev;
			} else {
				operator = '|';
				return prev;
			}
		}, '');
	} else {
		return filter.toString();
	}
}
