import Query from './Query';
import { Patch, diff, createPatch } from '../patch/Patch';
import filterFactory, { Filter } from './Filter';
import Promise from 'dojo-shim/Promise';
import WeakMap from 'dojo-shim/WeakMap';
import Map from 'dojo-shim/Map';
import { after } from 'dojo-core/aspect';
import { Observable } from 'rxjs/Observable';
import { Observer } from 'rxjs/Observer';
import { Subject } from 'rxjs/Subject';
import request, { Response, RequestOptions } from 'dojo-core/request';
import Evented from 'dojo-core/Evented';
import { Sort, sortFactory } from './Sort';
import { StoreRange, rangeFactory } from './Range';
import { QueryType } from './Query';
import { Handle, EventObject } from 'dojo-core/interfaces';
import { duplicate } from 'dojo-core/lang';
import { Transaction, SimpleTransaction } from './Transaction';

export type UpdateType = 'add' | 'update' | 'delete' | 'batch';

export interface Update<T> extends  EventObject {
	type: UpdateType;
}

export interface BatchUpdate<T> extends Update<T> {
	updates: Update<T>[]
}

export interface ItemAdded<T> extends Update<T> {
	item: T;
	index?: number;
}

export interface ItemUpdated<T> extends Update<T> {
	item: T;
	diff: () => Patch;
	index?: number;
	previousIndex?: number;
}

export interface ItemDeleted extends Update<any> {
	id: string;
	index?: number;
}


function isFilter<T>(filterOrTest: Query<T> | ((item: T) => boolean)): filterOrTest is Filter<T> {
	return typeof filterOrTest !== 'function' && (<Query<T>> filterOrTest).queryType === QueryType.Filter;
}

function isSort<T>(sortOrComparator: Sort<T> | ((a: T, b: T) => number)): sortOrComparator is Sort<T> {
	return typeof sortOrComparator !== 'function';
}

function isRange(query: Query<any>): query is Range<any> {
	return query.queryType === QueryType.Range;
}

export interface Store<T> {
	get(...ids: string[]): Promise<T[]>;
	getIds(...items: T[]): string[];
	generateId(): Promise<string>;
	add(...items: T[]): Promise<T[]>;
	put(...items: T[]): Promise<T[]>;
	patch(updates: Map<string, Patch>): Promise<T[]>;
	delete(...ids: string[]): Promise<string[]>;
	observe(...ids: string[]): Observable<T>;
	observe(): Observable<Update<T>>;
	release(): Promise<any>;
	track(): Promise<any>;
	fetch(...queries: Query<T>[]): Promise<T[]>;
	filter(filter: Filter<T>): Store<T>;
	filter(test: (item: T) => boolean): Store<T>;
	getUpdateCallback(): () => void;
	createFilter(): Filter<T>;
	range(range: StoreRange<T>): Store<T>;
	range(start: number, count: number): Store<T>;
	sort(sort: Sort<T> | ((a: T, b: T) => number) | string, descending?: boolean): Store<T>;
	transaction(): Transaction;
}

export interface StoreOptions<T, U extends Store<T>> {
	source?: U;
	queries?: Query<T>[];
}

export abstract class BaseStore<T, U extends BaseStore<T>> implements Store<T> {
	protected source: U;
	protected pauser: new Subject();
	protected sourceHandles: Handle[];
	protected queries: Query<T>[];
	protected StoreClass: new (...args: any[]) => Store<T>;
	protected getBeforePut: boolean;
	protected map: Map<T>;
	protected data: T[];
	protected version: number;
	protected isLive: boolean;
	protected inTransaction: boolean;
	protected itemObservers: Map<string, Observer<T>[]>;
	protected observers: Observer<Update<T>>[];

	constructor(options?: StoreOptions<T, U>) {
		options = options || {};
		this.source = options.source;
		this.queries = options.queries || [];
		this.StoreClass = <any> this.constructor;
		this.getBeforePut = true;
		this.version = this.source ? this.source.version : 1;
		this.inTransaction = false;
		this.setupUpdateAspects();
	}

	abstract getIds(...items: T[]): string[];
	abstract generateId(): Promise<string>;
	abstract createFilter(): Filter<T>;

	protected abstract _fetch(...queries: Query<T>[]): Promise<T[]>;
	protected abstract _get(...ids: string[]): Promise<T[]>;
	protected abstract _put(...itemsOrPatches: (T | Map<string, Patch>)[]): Promise<ItemUpdated<T>[]>;
	protected abstract _add(items: T[], indices?: number[]): Promise<ItemAdded<T>[]>;
	protected abstract _delete(ids: string[], index: number[]): Promise<ItemDeleted[]>;
	protected abstract _patch(updates: Map<string, Patch>): Promise<ItemUpdated<T>[]>;
	protected abstract handleUpdates(updates: Update<T>[]): void;
	protected abstract isUpdate(item: T): Promise<boolean>;

	release(): Promise<any> {
		if (this.source) {
			if (this.sourceHandles) {
				this.sourceHandles.forEach(handle => handle.destroy());
				this.sourceHandles = [];
			}
			return this.fetch().then(function(data) {
				this.data = duplicate(data);
				this.source = null;
				this.isLive = false;
				return this.data;
			}.bind(this));
		} else {
			return Promise.resolve();
		}
	}

	track(): Promise<Store<T>> {
		if (this.source) {
			this.sourceHandles = [
				this.source.on('batch', this.propagateUpdate.bind(this)),
				this.source.on('add', this.propagateUpdate.bind(this)),
				this.source.on('update', this.propagateUpdate.bind(this)),
				this.source.on('delete', this.propagateUpdate.bind(this))
			];
		}

		this.isLive = true;
		return this.fetch().then(function() {
			return this;
		});
	}

	transaction() {
		this.inTransaction = true;
		return new SimpleTransaction<T>(this);
	}

	get(...ids: string[]) {
		if (this.source) {
			return this.source.get(...ids);
		} else {
			return this._get(...ids);
		}
	}

	put(...items: T[]) {
		const self: BaseStore<T, any> = this;
		if (this.source) {
			return this.source.put(items);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}
            var isUpdate = Observable.fromCallback((item: T) => this.isUpdate(item));

            const updatesOrAdds = Observable.for(items, item => isUpdate(<T> item));
            return Promise.all([
				updatesOrAdds
					.where(x => x)
					.toArray()
					.toPromise()
					.then(items => self._put(items))
					.then(updates => self.sendItemUpdates(updates)),
                updatesOrAdds
					.where(x => !x)
					.toArray()
					.toPromise()
					.then(items => self._add(items))
            ])
                .then((updateLists: (ItemUpdated<T> | ItemAdded<T>)[][]) => updateLists.reduce((prev, next) => [...prev, ...next]))
                .then(updates => self.sendStoreUpdates(updates).map(update => update.item))
		}
	}

	patch(updates: Map<string, Patch>) {
		const self: BaseStore<T, any> = this;
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

	add(...items: T[]) {
		if (this.source) {
			return this.source.add(items);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}
			return this._add(...items)
				.then(updates => self.sendStoreUpdates(self.sendItemUpdates(updates)).map(update => update.item));
		}
	}

	delete(...ids: string[]) {
		if (this.source) {
			return this.source.delete(...ids);
		} else {
			if (typeof this.version !== 'undefined') {
				this.version++;
			}
			return this._delete(...ids).then(function(results: ItemDeleted[]) {
				return results.map(function(result) {
					return result.id;
				});
			});
		}
	}

	fetch(queries?: Query<T>[]) {
		if (this.source && (typeof this.version === 'undefined' || this.version !== this.source.version)) {
			return this.source.fetch(this.queries).then(function(fullData: T[]) {
				this.version = this.source.version;
				this.data = this.queries.reduce((prev: T[], next: Query<T>) => next.apply(prev), fullData);
				if (this.isLive) {
					return this.buildMap(this.data).then(function(map) {
						this.map = map;
						return this.data;
					});
				} else {
					return this.data;
				}
			}.bind(this));
		} else {
			return this._fetch(queries);
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
			sort = sortFactory(sortOrComparator, descending);
		}

		return this.query(sort);
	}

	protected query(query: Query<T>) {
		const options: StoreOptions<T, U> = this.getOptions();
		options.queries = [ ...(options.queries || []), query ];

		return this.createSubcollection(options);
	}

	protected createSubcollection(options: StoreOptions<T, U>): U {
		return <U> new this.StoreClass(options);
	}

	protected setupUpdateAspects(): void {
		const unwrapUpdates = function(updatePromises: Promise<Update<T>[]>) {
			updatePromises.then(this.handleUpdates.bind(this));
		}.bind(this);

		this._put = after(this._put, unwrapUpdates);
		this._add = after(this._add, unwrapUpdates);
		this._delete = after(this._delete, unwrapUpdates);
	}

	protected propagateUpdate(eventOrEvents: Update<T>): void {
		const events: Update<T>[] = (<BatchUpdate<T>> eventOrEvents).updates || [ eventOrEvents ];

		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		this.version += events.length;
		events.forEach(function(event) {
            switch (event.type) {
                case 'add':
                    this._add((<ItemAdded<T>> event).item);
                    break;
                case 'update':
                    this._put((<ItemUpdated<T>> event).item);
                    break;
                case 'delete':
                    this._delete((<ItemDeleted<T>> event).id);
                    break;
            }
		}, this);
	}

	getUpdateCallback() {
		return this.propagateUpdate.bind(this);
	}

	protected buildMap(collection: T[], map?: ItemMap<T>): Promise<{ [ index: string ]: { item: T, index: number } }> {
		const self = this;
		const _map = map || <ItemMap<T>> {};
		return Promise.resolve(this.getIds(...collection).map(function(id, index) {
			if (_map[id] && !map) {
				throw new Error('Collection contains item with duplicate ID');
			}
			return _map[id] = { item: collection[index], index: index };
		}));
	}

	protected getOptions(): StoreOptions<T, U> {
		return {
			source: this.source || this,
			queries: this.queries
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
				this.itemObservers.get(id).forEach(observer => observer.next(items[index]));
			}
		});
		return updates;
	}
}
