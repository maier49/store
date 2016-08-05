import Query, { CompoundQuery } from '../query/Query';
import Patch from '../patch/Patch';
import Filter from '../query/Filter';
import Promise from 'dojo-shim/Promise';
import Map from 'dojo-shim/Map';
import { Observer, Observable, Subject, Subscription } from '@reactivex/RxJS';
import { of } from '@reactivex/RxJS/dist/cjs/observable/of';
import { Sort, createSort } from '../query/Sort';
import StoreRange, { rangeFactory } from '../query/StoreRange';
import { QueryType } from '../query/Query';
import { duplicate } from 'dojo-core/lang';
import { Transaction, SimpleTransaction } from './Transaction';

export type UpdateType = 'add' | 'update' | 'delete' | 'batch';

export type ItemMap<T> = Map<string, { item: T; index: number }>;

export interface Update<T> {
	type: UpdateType;
}

export interface BatchUpdate<T> extends Update<T> {
	updates: Update<T>[];
}

export interface ItemAdded<T> extends Update<T> {
	item: T;
	index?: number;
}

export interface ItemUpdated<T> extends Update<T> {
	item: T;
	diff: () => Patch<T, T>;
	index?: number;
	previousIndex?: number;
}

export interface ItemDeleted extends Update<any> {
	id: string;
	index?: number;
}

function isFilter<T>(filterOrTest: Query<any, any> | ((item: T) => boolean)): filterOrTest is Filter<T> {
	return typeof filterOrTest !== 'function' && (<Query<any, any>> filterOrTest).queryType === QueryType.Filter;
}

function isSort<T>(sortOrComparator: Sort<T> | ((a: T, b: T) => number)): sortOrComparator is Sort<T> {
	return typeof sortOrComparator !== 'function';
}

export interface Store<T> {
	get(...ids: string[]): Promise<T[]>;
	getIds(...items: T[]): string[];
	generateId(): Promise<string>;
	add(...items: T[]): Promise<T[]>;
	put(...items: T[]): Promise<T[]>;
	patch(updates: Map<string, Patch<T, T>>): Promise<T[]>;
	delete(...ids: string[]): Promise<string[]>;
	observe(): Observable<Update<T>>;
	observe(ids: string | string[]): Observable<T | ItemDeleted>;
	release(): Promise<any>;
	track(): Promise<any>;
	fetch(): Promise<T[]>;
	fetch<U>(query: Query<T, U>): Promise<U[]>;
	filter(filter: Filter<T>): Store<T>;
	filter(test: (item: T) => boolean): Store<T>;
	getUpdateCallback(): () => void;
	createFilter(): Filter<T>;
	range(range: StoreRange<T>): Store<T>;
	range(start: number, count: number): Store<T>;
	sort(sort: Sort<T> | ((a: T, b: T) => number) | string, descending?: boolean): Store<T>;
	transaction(): Transaction<T>;
}

export interface StoreOptions<T> {
	source?: Store<T>;
	sourceQuery?: Query<T, T>;
}

export interface BaseStoreOptions<T> extends StoreOptions<T> {
	source?: BaseStore<T>;
}

export abstract class BaseStore<T> implements Store<T> {
	protected source: BaseStore<T>;
	protected pauser: Subject<any> = new Subject();
	protected sourceHandle: Subscription;
	protected sourceQuery: CompoundQuery<any, T>;
	protected version: number;
	protected StoreClass: new (...args: any[]) => BaseStore<T>;
	protected getBeforePut: boolean;
	protected map: Map<string, { item: T; index: number }>;
	protected data: T[];
	protected isLive: boolean;
	protected inTransaction: boolean;
	protected itemObservers: Map<string, { observes: Set<string>; observer: Observer<T | ItemDeleted> }[]>;
	protected observers: Observer<Update<T>>[];
	protected observable: Observable<Update<T>> = new Observable<Update<T>>(function subscribe(observer: Observer<Update<T>>) {
		this.observers.push(observer);
		this.fetch().then(function(data: T[]) {
			const update: BatchUpdate<T> = {
				type: 'batch',
				updates: []
			};

			observer.next(data.reduce((prev, next, index) => {
				prev.updates.push(<ItemAdded<T>> {
					type: 'add',
					item: next,
					index: index
				});
				return prev;
			}, update));
		});
	}.bind(this));

	constructor(options?: BaseStoreOptions<T>) {
		options = options || {};
		this.source = options.source;
		if (options.sourceQuery) {
			this.sourceQuery = new CompoundQuery(options.sourceQuery);
		}
		this.StoreClass = <any> this.constructor;
		this.getBeforePut = true;
		this.version = this.source ? this.source.version : 1;
		this.inTransaction = false;
	}

	abstract getIds(...items: T[]): string[];
	abstract generateId(): Promise<string>;
	abstract createFilter(): Filter<T>;

	protected abstract _fetch(): Promise<T[]>;
	protected abstract _fetch<V>(query: Query<T, V>): Promise<V[]>;
	protected abstract _get(...ids: string[]): Promise<T[]>;
	protected abstract _put(...itemsOrPatches: (T | Map<string, Patch<T, T>>)[]): Promise<ItemUpdated<T>[]>;
	protected abstract _add(items: T[], indices?: number[]): Promise<ItemAdded<T>[]>;
	protected abstract _delete(ids: string[], indices?: number[]): Promise<ItemDeleted[]>;
	protected abstract _patch(updates: Map<string, Patch<T, T>>): Promise<ItemUpdated<T>[]>;
	protected abstract isUpdate(item: T): Promise<boolean>;

	release(): Promise<any> {
		if (this.source) {
			if (this.sourceHandle) {
				this.sourceHandle.unsubscribe();
				this.sourceHandle = null;
			}
			return this.fetch().then(function(data: T[]) {
				this.data = duplicate(data);
				this.source = null;
				this.isLive = false;
				return this.data;
			}.bind(this));
		} else {
			return Promise.resolve();
		}
	}

	track(): Promise<BaseStore<T>> {
		if (this.source) {
			this.sourceHandle = this.source.observe().subscribe(function(update: Update<T>) {
				this.propagateUpdate(update);
			});
		}

		this.isLive = true;
		return this.fetch().then(function() {
			return this;
		});
	}

	transaction(): Transaction<T> {
		this.inTransaction = true;
		return new SimpleTransaction<T>(this, this.pauser);
	}

	get(...ids: string[]): Promise<T[]> {
		if (this.source) {
			return this.source.get(...ids);
		} else {
			return this._get(...ids);
		}
	}

	put(...items: T[]): Promise<T[]> {
		const self: BaseStore<T> = this;
		if (this.source) {
			return this.source.put(...items);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}

			const updatesOrAdds = of(...items).map(this.isUpdate.bind(this));
			return Promise.all([
				updatesOrAdds
					.filter(x => Boolean(x))
					.toArray()
					.toPromise()
					.then((items: T[]) => self._put(...items))
					.then(updates => self.sendItemUpdates(updates)),
				updatesOrAdds
					.filter(x => !Boolean(x))
					.toArray()
					.toPromise()
					.then((items: T[]) => self._add(items))
			])
				.then((updateLists: (ItemUpdated<T> | ItemAdded<T>)[][]) => updateLists.reduce((prev, next) => [...prev, ...next]))
				.then(updates => self.sendStoreUpdates(updates).map((update: ItemUpdated<T> | ItemAdded<T>) => update.item));
		}
	}

	patch(updates: Map<string, Patch<T, T>>): Promise<T[]> {
		const self: BaseStore<T> = this;
		if (this.source) {
			return this.source.patch(updates);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}

			return this._patch(updates)
				.then(updates => self.sendStoreUpdates(self.sendItemUpdates(updates)).map(update => update.item));
		}
	}

	add(...items: T[]): Promise<T[]> {
		const self: BaseStore<T> = this;
		if (this.source) {
			return this.source.add(...items);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}
			return this._add(items)
				.then((updates: ItemAdded<T>[]) => self.sendStoreUpdates(self.sendItemUpdates(updates)).map(update => update.item));
		}
	}

	delete(...ids: string[]): Promise<string[]> {
		const self: BaseStore<T> = this;
		if (this.source) {
			return this.source.delete(...ids);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}
			return this._delete(ids).then(self.cancelItems);
		}
	}

	fetch(): Promise<T[]>;
	fetch<V>(query: Query<T, V>): Promise<V[]>;
	fetch<V>(query?: Query<T, V>): Promise<V[]> | Promise<T[]> {
		const self = <BaseStore<T>> this;
		if (this.source && (typeof this.version === 'undefined' || this.version !== this.source.version)) {
			const transformQuery: Query<T, V> =
				query ? (this.sourceQuery ? this.sourceQuery.withQuery(query) : query) : null;
			const handleData = function(data: T[]) {
				self.data = data;
				self.version = self.source.version;
				if (self.isLive) {
					return self.buildMap(self.data).then(function(map: ItemMap<T>) {
						self.map = map;
						return self.data;
					});
				} else {
					return Promise.resolve(self.data);
				}
			};
			if (transformQuery) {
				return <Promise<V[]>> this.source.fetch(transformQuery);
			} else {
				return <Promise<T[]>> this.source.fetch(this.sourceQuery).then(handleData);
			}
		} else {
			return this._fetch(query);
		}
	}

	filter(filterOrTest: Filter<T> | ((item: T) => boolean)) {
		let filter: Filter<T>;
		if (isFilter(filterOrTest)) {
			filter = filterOrTest;
		} else {
			filter = this.createFilter().custom(filterOrTest);
		}

		return this.query(filter);
	}

	range(rangeOrStart: StoreRange<T> | number, count?: number) {
		let range: StoreRange<T>;
		if (typeof count !== 'undefined') {
			range = rangeFactory<T>(<number> rangeOrStart, count);
		} else {
			range = <StoreRange<T>> rangeOrStart;
		}

		return this.query(range);
	}

	sort(sortOrComparator: Sort<T> | ((a: T, b: T) => number), descending?: boolean) {
		let sort: Sort<T>;
		if (isSort(sortOrComparator)) {
			sort = sortOrComparator;
		} else {
			sort = createSort(sortOrComparator, descending);
		}

		return this.query(sort);
	}

	protected query(query: Query<T, T>) {
		const options = this.getOptions();
		if (options.sourceQuery) {
			const compoundQuery: CompoundQuery<T, T> = options.sourceQuery instanceof CompoundQuery ?
				<CompoundQuery<T, T>> options.sourceQuery : new CompoundQuery(options.sourceQuery);
			options.sourceQuery = compoundQuery.withQuery(query);
		} else {
			options.sourceQuery = query;
		}

		return this.createSubcollection(options);
	}

	protected createSubcollection(options: BaseStoreOptions<T>): BaseStore<T> {
		return new this.StoreClass(options);
	}

	protected propagateUpdate(updateOrUpdates: Update<T>): void {
		const updates: Update<T>[] = (<BatchUpdate<T>> updateOrUpdates).updates || [updateOrUpdates];

		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		this.version += updates.length;
		updates.forEach(function(update) {
			switch (update.type) {
				case 'add':
					this._add((<ItemAdded<T>> update).item);
					break;
				case 'update':
					this._put((<ItemUpdated<T>> update).item);
					break;
				case 'delete':
					this._delete((<ItemDeleted> update).id);
					break;
			}
		}, this);
	}

	getUpdateCallback() {
		return this.propagateUpdate.bind(this);
	}

	protected buildMap(collection: T[], map?: ItemMap<T>): Promise<ItemMap<T>> {
		const _map = map || <ItemMap<T>> new Map();
		return Promise.resolve(this.getIds(...collection).reduce(function(_map, id, index) {
			if (_map.has(id) && !map) {
				throw new Error('Collection contains item with duplicate ID');
			}
			_map.set(id, { item: collection[index], index: index });
			return _map;
		}, _map));
	}

	protected getOptions(): BaseStoreOptions<T> {
		return {
			source: this.source || this,
			sourceQuery: this.sourceQuery
		};
	}

	protected sendStoreUpdates<T, U extends Update<T>>(updates: U[]): U[] {
		const batchUpdate: BatchUpdate<T> = {
			type: 'batch',
			updates: updates
		};
		this.observers.forEach(observer => observer.next(batchUpdate));
		return updates;
	}

	protected sendItemUpdates(updates: (ItemUpdated<T> | ItemAdded<T>)[]) {
		const items = updates.map(update => update.item);
		const ids = this.getIds(...items);
		ids.forEach((id, index) => {
			if (this.itemObservers.has(id)) {
				this.itemObservers.get(id).forEach(observerEntry => observerEntry.observer.next(items[index]));
			}
		});
		return updates;
	}

	protected cancelItems(itemDeletedUpdates: ItemDeleted[]): string[] {
		const self: BaseStore<T> = this;
		return itemDeletedUpdates.map(itemDeletedUpdate => {
			const id = itemDeletedUpdate.id;
			if (self.itemObservers.has(id)) {
				self.itemObservers.get(id).forEach(observerEntry => {
					observerEntry.observes.delete(id);
					observerEntry.observer.next(itemDeletedUpdate);
					if (!observerEntry.observes.size) {
						observerEntry.observer.complete();
					}
				});
				self.itemObservers.delete(id);
			}
			return id;
		});
	}

	public observe(): Observable<Update<T>>;
	public observe(idOrIds: string | string[]): Observable<T | ItemDeleted>;
	public observe(idOrIds?: string | string[]): any {
		if (idOrIds) {
			const ids: string[] = Array.isArray(idOrIds) ? <string[]> idOrIds : [ <string> idOrIds ];
			return new Observable<T | ItemDeleted>(function subscribe(observer: Observer<T | ItemDeleted>) {
				const idSet = new Set<string>(ids);
				this.get(...ids).then((items: T[]) => {
					const retrievedIdSet = new Set<string>(this.getIds(items));
					let missingItemIds: string[];
					if (retrievedIdSet.size !== idSet.size || (missingItemIds = Array.from(idSet.values()).filter(id => !retrievedIdSet.has(id))).length) {
						observer.error(new Error(`ID(s) "${missingItemIds}" not found in store`));
					} else {
						const observerEntry: { observes: Set<string>; observer: Observer<T | ItemDeleted>} = {
							observes: idSet,
							observer: observer
						};
						(<string[]> ids).forEach(id => {
							if (this.itemObservers.has(id)) {
								this.itemObservers.get(id).push(observerEntry);
							} else {
								this.itemObservers.set(id, [observerEntry]);
							}
						}, this);
						items.forEach(item => observer.next(item));
					}
				});
			}.bind(this));
		} else {
			return this.observable;
		}
	}
}
