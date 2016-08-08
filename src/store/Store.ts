import Query, {CompoundQuery} from '../query/Query';
import Patch from '../patch/Patch';
import Filter from '../query/Filter';
import Promise from 'dojo-shim/Promise';
import Set from 'dojo-shim/Set';
import Map from 'dojo-shim/Map';
import {after} from 'dojo-core/aspect';
import {Observer, Observable, Subject, Subscription} from '@reactivex/RxJS';
import {of} from '@reactivex/RxJS/dist/cjs/observable/of';
import {Sort, createSort} from '../query/Sort';
import StoreRange, {rangeFactory} from '../query/StoreRange';
import {QueryType} from '../query/Query';
import {duplicate} from 'dojo-core/lang';
import {Transaction, SimpleTransaction} from './Transaction';
import StoreActionManager from '../storeActions/StoreActionManager';
import {
	StoreActionResult, StoreUpdateFunction, StoreUpdateResult, createPutAction, createPatchAction, createAddAction,
	createDeleteAction, StoreAction, StoreActionDatum, StoreActionData, StoreActionType
} from '../storeActions/StoreAction';

export type UpdateType = 'basic' | 'add' | 'update' | 'patch' | 'delete';

export type ItemEntry<T> = {
	item: T;
	index: number;
	updatedVersion: number;
}

export type ItemMap<T> = Map<string, ItemEntry<T>>;

export interface ItemAdded<T> {
	item: T;
	id: string;
	index: number;
}

export interface ItemUpdated<T> extends ItemAdded<T> {
	previousIndex?: number;
	diff: () => Patch<T, T>;
}

export interface ItemDeleted {
	id: string;
	index?: number;
}

export interface Update<T> {
	type: UpdateType;
	error?: StoreUpdateResult<T>;
}

export interface ItemsAdded<T> extends Update<T> {
	itemsAdded: ItemAdded<T>[];
}

export interface ItemsUpdated<T> extends Update<T> {
	itemsUpdated: ItemUpdated<T>[];
}

export interface ItemsDeleted<T> extends Update<T> {
	itemsDeleted: ItemDeleted[];
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
	add(...items: T[]): Observable<StoreActionResult<T>>;
	put(...items: T[]): Observable<StoreActionResult<T>>;
	patch(updates: Map<string, Patch<T, T>> | { id: string; patch: Patch<T, T> }[]): Observable<StoreActionResult<T>>;
	delete(...ids: string[]): Observable<StoreActionResult<T>>;
	observe(): Observable<Update<T>>;
	observe(ids: string | string[]): Observable<T | ItemDeleted>;
	release(actionManager?: StoreActionManager<T>): Promise<any>;
	track(): Promise<any>;
	fetch(): Promise<T[]>;
	fetch<U>(query: Query<T, U>): Promise<U[]>;
	filter(filter: Filter<T>): Store<T>;
	filter(test: (item: T) => boolean): Store<T>;
	createFilter(): Filter<T>;
	range(range: StoreRange<T>): Store<T>;
	range(start: number, count: number): Store<T>;
	sort(sort: Sort<T> | ((a: T, b: T) => number) | string, descending?: boolean): Store<T>;
	transaction(): Transaction<T>;
	version: number;
}

export interface StoreOptions<T> {
	source?: Store<T>;
	sourceQuery?: Query<T, T>;
}

export interface BaseStoreOptions<T> extends StoreOptions<T> {
	source?: BaseStore<T>;
	actionManager?: StoreActionManager<T>;
}

export abstract class BaseStore<T> implements Store<T> {
	protected source: BaseStore<T>;
	protected pauser: Subject<any> = new Subject();
	protected sourceSubscription: Subscription;
	protected sourceQuery: CompoundQuery<any, T>;
	protected StoreClass: new (...args: any[]) => BaseStore<T>;
	protected getBeforePut: boolean;
	protected map: ItemMap<T>;
	protected data: T[];
	protected isLive: boolean;
	protected inTransaction: boolean;
	protected itemObservers: Map<string, { observes: Set<string>; observer: Observer<ItemUpdated<T> | ItemAdded<T> | ItemDeleted> }[]>;
	protected observers: Observer<Update<T>>[];
	protected actionManager: StoreActionManager<T>;
	protected observable: Observable<Update<T>> = new Observable<Update<T>>(function subscribe(observer: Observer<Update<T>>) {
		this.observers.push(observer);
		this.fetch().then(function(data: T[]) {
			const update: ItemsAdded<T> = {
				type: 'add',
				itemsAdded: []
			};
			const ids = this.getIds(...data);

			data.forEach((item, index) => update.itemsAdded.push(<ItemAdded<T>> {
				type: 'add',
				item: item,
				id: ids[index],
				index: index
			}));

			observer.next(update);
		});

		return () => this.observers.splice(this.observers.indexOf(observer), 1);
	}.bind(this));

	constructor(options?: BaseStoreOptions<T>) {
		options = options || {};
		this.source = options.source;
		if (options.sourceQuery) {
			this.sourceQuery = new CompoundQuery(options.sourceQuery);
		}

		this.sourceSubscription = this.source.observe().subscribe(function(update: Update<T>) {
			this.observers.forEach((observer: Observer<Update<T>>) => observer.next({
				type: 'basic'
			}));
		}.bind(this));

		this.StoreClass = <any> this.constructor;
		this.getBeforePut = true;
		this.version = this.source ? this.source.version : 1;
		this.inTransaction = false;
		if (options.actionManager) {
			this.actionManager = options.actionManager;
		}

		this.setupUpdateAspects();
	}

	abstract getIds(...items: T[]): string[];

	abstract generateId(): Promise<string>;

	abstract createFilter(): Filter<T>;

	protected abstract _fetch(): Promise<T[]>;
	protected abstract _fetch<V>(query: Query<T, V>): Promise<V[]>;

	protected abstract _get(...ids: string[]): Promise<T[]>;

	protected abstract createPut(items: T[]): StoreUpdateFunction<T>;

	protected abstract createAdd(items: T[], indices?: number[]): StoreUpdateFunction<T>

	protected abstract createDelete(ids: string[], indices?: number[]): StoreUpdateFunction<T>;

	protected abstract createPatch(updates: { id: string; patch: Patch<T, T> }[]): StoreUpdateFunction<T>;

	protected abstract isUpdate(item: T): Promise<{ item: T, id: string }>;

	version: number;

	release(actionManager?: StoreActionManager<T>): Promise<any> {
		if (this.source) {
			if (this.sourceSubscription) {
				this.sourceSubscription.unsubscribe();
				this.sourceSubscription = null;
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
			if (this.sourceSubscription) {
				this.sourceSubscription.unsubscribe();
			}
			this.sourceSubscription = this.source.observe().subscribe(function(update: Update<T>) {
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

	put(...items: T[]): Observable<StoreActionResult<T>> {
		if (this.source) {
			return this.source.put(...items);
		} else {
			return this.localPut(items);
		}
	}

	protected localPut(items: T[]): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		const action = createPutAction(this.combinePutUpdateFunctions(items), items, self);
		self.actionManager.queue(action);
		return action.observable;
	}

	protected combinePutUpdateFunctions(items: T[]): StoreUpdateFunction<T> {
		const self: BaseStore<T> = this;
		const updatesOrAdds = of(...items).map(this.isUpdate.bind(this));
		return function() {
			return Promise.all([
				updatesOrAdds
					.filter(x => Boolean(x))
					.toArray()
					.toPromise()
					.then((areUpdates: { item: T, id: string }[]) => self.createPut(areUpdates.map(isUpdate => isUpdate.item))),
				updatesOrAdds
					.filter(x => !Boolean(x))
					.toArray()
					.toPromise()
					.then((areUpdates: { item: T, id: string }[]) => self.createAdd(areUpdates.map(isUpdate => isUpdate.item)))
			])
				.then(([putUpdateFunction, addUpdateFunction]: Array<StoreUpdateFunction<T>>) =>
					Promise.all([putUpdateFunction(), addUpdateFunction()])
						.then(([ putResults, addResults ]: StoreUpdateResult<T>[]) => ({
							currentItems: [...putResults.currentItems, ...addResults.currentItems],
							failedData: [...putResults.failedData, ...addResults.failedData],
							successfulData: [...putResults.successfulData, ...addResults.successfulData],
							store: self,
							retry: (failedData: T[]) => self.combinePutUpdateFunctions(failedData)()
						}))
				);
		};
	}

	patch(updates: Array<{ id: string; patch: Patch<T, T> }> | Map<string, Patch<T, T>>): Observable<StoreActionResult<T>> {
		if (this.source) {
			return this.source.patch(updates);
		} else {
			let updateArray: Array<{ id: string; patch: Patch<T, T> }>;
			if (updates instanceof Map) {
				updateArray = [];
				let iterator = updates.keys();
				let next: { done: boolean, value?: string };
				while (!(next = iterator.next()).done) {
					updateArray.push({
						id: next.value,
						patch: updates.get(next.value)
					});
				}
			} else {
				updateArray = <Array<{ id: string; patch: Patch<T, T> }>> updates;
			}
			return this.localPatch(updateArray);
		}
	}

	protected localPatch(updates: { id: string; patch: Patch<T, T> }[]): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		const action = createPatchAction(this.createPatch(updates), updates, self);
		this.actionManager.queue(action);
		return action.observable;
	}

	add(...items: T[]): Observable<StoreActionResult<T>> {
		if (this.source) {
			return this.source.add(...items);
		} else {
			return this.localAdd(items);
		}
	}

	protected localAdd(items: T[]): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		const action = createAddAction(this.createAdd(items), items, self);
		this.actionManager.queue(action);
		return action.observable;
	}

	delete(...ids: string[]): Observable<StoreActionResult<T>> {
		if (this.source) {
			return this.source.delete(...ids);
		} else {
			return this.localDelete(ids);
		}
	}

	protected localDelete(ids: string[]): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		const action = createDeleteAction(this.createDelete(ids), ids, self);
		this.actionManager.queue(action);
		return action.observable;
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

	protected propagateUpdate(updates: Update<T>[]): void {
		if (typeof this.version !== 'undefined') {
			this.version++;
		}
		this.version += updates.length;
		updates.forEach(function(update) {
			switch (update.type) {
				case 'add':
					this.localAdd((<ItemsAdded<T>> update).itemsAdded.map(itemAdded => itemAdded.item));
					break;
				case 'update':
					this.localPut((<ItemsUpdated<T>> update).itemsUpdated.map(itemUpdated => itemUpdated.item));
					break;
				case 'patch':
					this.localPatch((<ItemsUpdated<T>> update).itemsUpdated.map(itemUpdated => ({
						id: this.getIds(itemUpdated.item)[0],
						patch: itemUpdated.diff()
					})));
					break;
				case 'delete':
					this.localDelete((<ItemsDeleted<T>> update).itemsDeleted.map(itemDeleted => itemDeleted.id));
					break;
			}
		}, this);
	}

	protected buildMap(collection: T[], map?: ItemMap<T>): Promise<ItemMap<T>> {
		const version = this.version;
		const _map = map || <ItemMap<T>> new Map();
		return Promise.resolve(this.getIds(...collection).reduce(function(_map, id, index) {
			if (_map.has(id) && !map) {
				throw new Error('Collection contains item with duplicate ID');
			}
			_map.set(id, {item: collection[index], index: index, updatedVersion: version});
			return <ItemMap<T>> _map;
		}, _map));
	}

	protected getOptions(): BaseStoreOptions<T> {
		return {
			source: this.source || this,
			sourceQuery: this.sourceQuery
		};
	}

	public observe(): Observable<Update<T>>;
	public observe(idOrIds: string | string[]): Observable<T | ItemDeleted>;
	public observe(idOrIds?: string | string[]): any {
		if (idOrIds) {
			const ids: string[] = Array.isArray(idOrIds) ? <string[]> idOrIds : [<string> idOrIds];
			return new Observable<T | ItemDeleted>(function subscribe(observer: Observer<T | ItemDeleted>) {
				const idSet = new Set<string>(Array.from(ids));
				this.get(...ids).then((items: T[]) => {
					const retrievedIdSet = new Set<string>(Array.from<string>(this.getIds(items)));
					let missingItemIds: string[];
					if (retrievedIdSet.size !== idSet.size || (missingItemIds = ids.filter(id => !retrievedIdSet.has(id))).length) {
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

	protected setupUpdateAspects() {
		after(this, 'localPut', this.sendUpdates.bind(this));
		after(this, 'localPatch', this.sendUpdates.bind(this));
		after(this, 'localAdd', this.sendUpdates.bind(this));
		after(this, 'localDelete', this.cancelItems.bind(this));
	}

	protected sendUpdates(resultPromise: Promise<StoreActionResult<T>>): Promise<StoreActionResult<T>> {
		const self = <BaseStore<T>> this;
		return resultPromise.then(function(result) {
			const updates = result.successfulData;
			const ids = updates.map(update => update.id);
			ids.forEach((id, index) => {
				if (self.itemObservers.has(id)) {
					self.itemObservers.get(id).forEach(observerEntry => observerEntry.observer.next(updates[index]));
				}
			});
			if (self.map) {
				ids.forEach((id) => {
					if (self.map.has(id)) {
						self.map.get(id).updatedVersion = self.version;
					}
				});
			}
			return result;
		});
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

	protected rejectIfOutdated(action: StoreAction<T>) {
		const self = <BaseStore<T>> this;
		const ids: string[] = action.targetedItems.map(function(item: StoreActionDatum<T>) {
			if (typeof item === 'string') {
				return <string> item;
			} else if ((<any> item).id && (<any> item).patch && typeof (<any> item).id === 'string') {
				return <string> (<any> item).id;
			} else {
				return self.getIds(<T> item)[0];
			}
		});
		let currentItems: T[] = [];
		let newTargets: StoreActionData<T> = (<Array<string | T>> action.targetedItems).filter((item, index) =>
			(!self.map.has(ids[index])) || (self.map.get(ids[index]).updatedVersion <= action.targetedVersion)
		);
		let outdatedData: StoreActionData<T> = (<Array<string | T>> action.targetedItems).filter((item, index) => {
			const result = self.map.has(ids[index]) && self.map.get(ids[index]).updatedVersion > action.targetedVersion;
			if (result) {
				currentItems.push(self.map.get(ids[index]).item);
			}
			return result;
		});
		let newAction: StoreAction<T>;
		switch (action.type) {
			case StoreActionType.Delete:
				newAction = createDeleteAction(
					self.createDelete(<string[]> newTargets),
					newTargets,
					self,
					outdatedData,
					currentItems
				);
				break;
			case StoreActionType.Add:
				newAction = createAddAction(
					self.createAdd(<T[]> newTargets),
					newTargets,
					self,
					outdatedData,
					currentItems
				);
				break;
			case StoreActionType.Put:
				newAction = createPutAction(
					self.createPut(<T[]> newTargets),
					newTargets,
					self,
					outdatedData,
					currentItems
				);
				break;
			case StoreActionType.Patch:
				newAction = createPatchAction(
					self.createPatch(<{id: string, patch: Patch<T, T> }[]> newTargets),
					newTargets,
					self,
					outdatedData,
					currentItems
				);
				break;
		}

		return newAction;
	}
}
