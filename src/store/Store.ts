import Query, { CompoundQuery } from '../query/Query';
import Patch from '../patch/Patch';
import Filter, { createFilter } from '../query/Filter';
import Promise from 'dojo-shim/Promise';
import Set from 'dojo-shim/Set';
import Map from 'dojo-shim/Map';
import { after } from 'dojo-core/aspect';
import { Observer, Observable, Subscription } from 'rxjs';
import { Sort, createSort } from '../query/Sort';
import StoreRange, { rangeFactory } from '../query/StoreRange';
import { QueryType } from '../query/Query';
import { duplicate } from 'dojo-core/lang';
import { Transaction, SimpleTransaction } from './Transaction';
import StoreActionManager, { AsyncPassiveActionManager } from '../storeActions/StoreActionManager';
import {
	StoreActionResult, StoreUpdateFunction, StoreUpdateResult, createPutAction, createPatchAction, createAddAction,
	createDeleteAction, StoreActionDatum, StoreActionData, StoreUpdateResultData, StoreUpdateDataFunction, FilteredData
} from '../storeActions/StoreAction';

export type UpdateType = 'basic' | 'add' | 'update' | 'patch' | 'delete';

export type ItemEntry<T> = {
	item: T;
	index: number;
	updatedVersion: number;
}

export type ItemMap<T> = Map<string, ItemEntry<T>>;

export interface Update<T> {
	type: UpdateType;
	id: string;
}
export interface ItemAdded<T> extends Update<T> {
	item: T;
	index: number;
}

export interface ItemUpdated<T> extends ItemAdded<T> {
	previousIndex?: number;
	diff?: () => Patch<T, T>;
}

export interface ItemDeleted extends Update<any> {
	index?: number;
}

export interface MultiUpdate<T> {
	type: UpdateType;
}

export interface BatchUpdate<T> extends MultiUpdate<T> {
	updates: Update<T>[];
}

export interface ItemsAdded<T> extends BatchUpdate<T> {
	updates: ItemAdded<T>[];
}

export interface ItemsUpdated<T> extends BatchUpdate<T> {
	updates: ItemUpdated<T>[];
}

export interface ItemsDeleted<T> extends BatchUpdate<T> {
	updates: ItemDeleted[];
}

function isFilter<T>(filterOrTest: Query<any, any> | ((item: T) => boolean)): filterOrTest is Filter<T> {
	return typeof filterOrTest !== 'function' && (<Query<any, any>> filterOrTest).queryType === QueryType.Filter;
}

function isSort<T>(sortOrComparator: Sort<T> | ((a: T, b: T) => number) | string): sortOrComparator is Sort<T> {
	const paramType = typeof sortOrComparator;
	return paramType !== 'function' && paramType !== 'string' && typeof (<Sort<T>> sortOrComparator).apply === 'function';
}

export interface Store<T> {
	get(...ids: string[]): Promise<T[]>;
	getIds(...items: T[]): string[];
	generateId(): Promise<string>;
	add(...items: T[]): Observable<StoreActionResult<T>>;
	put(...items: T[]): Observable<StoreActionResult<T>>;
	patch(updates: Map<string, Patch<T, T>> | { id: string; patch: Patch<T, T> } | { id: string; patch: Patch<T, T> }[]): Observable<StoreActionResult<T>>;
	delete(...ids: string[]): Observable<StoreActionResult<T>>;
	observe(): Observable<MultiUpdate<T>>;
	observe(ids: string | string[]): Observable<Update<T>>;
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
	failOnDirtyData?: boolean;
}

export interface BaseStoreOptions<T> extends StoreOptions<T> {
	source?: BaseStore<T>;
	actionManager?: StoreActionManager<T>;
}

export abstract class BaseStore<T> implements Store<T> {
	protected failOnDirtyData: boolean;
	protected source: BaseStore<T>;
	protected sourceSubscription: Subscription;
	protected sourceQuery: CompoundQuery<any, T>;
	protected StoreClass: new (...args: any[]) => BaseStore<T>;
	protected getBeforePut: boolean;
	protected map: ItemMap<T> = new Map<string, ItemEntry<T>>();
	protected data: T[];
	protected isLive: boolean;
	protected itemObservers: Map<string, { observes: Set<string>; observer: Observer<Update<T>> }[]> =
		new Map<string, { observes: Set<string>; observer: Observer<Update<T>> }[]>();
	protected observers: Observer<MultiUpdate<T>>[] = [];
	protected actionManager: StoreActionManager<T>;
	protected removeObservers: number[] = [];
	protected observable: Observable<MultiUpdate<T>> = new Observable<MultiUpdate<T>>(function subscribe(this: BaseStore<T>, observer: Observer<MultiUpdate<T>>) {
		this.observers.push(observer);
		this.fetch().then(function(this: Store<T>, data: T[]) {
			if (data.length) {
				const update: ItemsAdded<T> = {
					type: 'add',
					updates: []
				};
				const ids = this.getIds(...data);

				data.forEach((item, index) => update.updates.push(<ItemAdded<T>> {
					type: 'add',
					item: item,
					id: ids[index],
					index: index
				}));

				observer.next(update);
			}
		}.bind(this));

		return () => this.removeObservers.push(this.observers.indexOf(observer));
	}.bind(this));

	constructor(options?: BaseStoreOptions<T>) {
		options = options || {};
		this.source = options.source;
		if (options.sourceQuery) {
			this.sourceQuery = new CompoundQuery(options.sourceQuery);
		}

		if (this.source) {
			this.sourceSubscription = this.source.observe().subscribe(function(this: BaseStore<T>, update: MultiUpdate<T>) {
				this.observers.forEach((observer: Observer<MultiUpdate<T>>) => observer.next({
					type: 'basic'
				}));
			}.bind(this));
		}

		this.StoreClass = <any> this.constructor;
		this.getBeforePut = true;
		this.version = this.source ? (this.source.version - 1) : 1;
		this.actionManager = options.actionManager || new AsyncPassiveActionManager<T>();
		this.failOnDirtyData = options.failOnDirtyData;

		this.setupUpdateAspects();
	}

	abstract getIds(...items: T[]): string[];

	abstract generateId(): Promise<string>;

	createFilter(): Filter<T> {
		return createFilter<T>();
	}

	protected abstract _fetch(): Promise<T[]>;
	protected abstract _fetch<V>(query: Query<T, V>): Promise<V[]>;

	protected abstract _get(ids: string[]): Promise<T[]>;

	protected abstract _put(items: T[]): Promise<StoreUpdateResultData<T, T>>;

	protected abstract _add(items: T[]): Promise<StoreUpdateResultData<T, T>>

	protected abstract _delete(ids: string[]): Promise<StoreUpdateResultData<T, string>>;

	protected abstract _patch(updates: { id: string; patch: Patch<T, T> }[]): Promise<StoreUpdateResultData<T, { id: string; patch: Patch<T, T> }>>;

	protected abstract isUpdate(item: T): Promise<{ isUpdate: boolean; item: T, id: string }>;

	version: number;

	release(actionManager?: StoreActionManager<T>): Promise<any> {
		if (this.source) {
			if (this.sourceSubscription) {
				this.sourceSubscription.unsubscribe();
				this.sourceSubscription = null;
			}
			return this.fetch().then(function(this: BaseStore<T>, data: T[]) {
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
			this.sourceSubscription = this.source.observe().subscribe(function(this: BaseStore<T>, update: MultiUpdate<T>) {
				this.propagateUpdate(update);
			});
		}

		this.isLive = true;
		return this.fetch().then(function(this: BaseStore<T>) {
			return this;
		});
	}

	transaction(): Transaction<T> {
		return new SimpleTransaction<T>(this);
	}

	get(...ids: string[]): Promise<T[]> {
		if (this.source) {
			return this.source.get(...ids);
		} else {
			return this.actionManager.queue((): Promise<T[]> => this._get(ids));
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
		const action = createPutAction(this.combinePutUpdateFunctions(items), items, self);
		self.actionManager.queue(action);
		return action.observable;
	}

	protected combinePutUpdateFunctions(items: T[]): StoreUpdateFunction<T, T> {
		const self: BaseStore<T> = this;
		const version = self.version;
		return function() {
			const updatesOrAdds = Promise.all(items.map(item => self.isUpdate(item)));
			return Promise.all([
				updatesOrAdds
					.then((updateCandidates: { isUpdate: boolean; item: T; id: string }[]): T[] => updateCandidates
						.filter(x => x.isUpdate)
						.map(isUpdate => isUpdate.item)
					).then((updates: T[]) => self.createUpdateFunction<T>(self._put, updates, version)),
				updatesOrAdds
					.then((addCandidates: { isUpdate: boolean; item: T; id: string }[]) => addCandidates
						.filter(x => !x.isUpdate)
						.map(isUpdate => isUpdate.item)
					).then((adds: T[]) => self.createUpdateFunction(self._add, adds, version))
			]).then(function([putUpdateFunction, addUpdateFunction]: StoreUpdateFunction<T, T>[]) {
				return Promise.all([putUpdateFunction(), addUpdateFunction()])
					.then(function([ putResults, addResults ]: StoreUpdateResult<T, T>[]) {
						return {
							currentItems: (putResults.currentItems || addResults.currentItems) ?
								[...(putResults.currentItems || []), ...(addResults.currentItems || [])] : null,
							failedData: (putResults.failedData || addResults.failedData) ?
								[...(putResults.failedData || []), ...(addResults.failedData || [])] : null,
							successfulData: <ItemsUpdated<T>> {
								type: 'update',
								updates: [...putResults.successfulData.updates, ...addResults.successfulData.updates]
							},
							store: self,
							retry: (failedData: T[]) => self.combinePutUpdateFunctions(failedData)()
						};
					});
			});
		};
	}

	patch(updates: { id: string; patch: Patch<T, T> } | Array<{ id: string; patch: Patch<T, T> }> | Map<string, Patch<T, T>>): Observable<StoreActionResult<T>> {
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
			} else if (Array.isArray(updates)) {
				updateArray = <Array<{ id: string; patch: Patch<T, T> }>> updates;
			} else {
				updateArray = [ <{ id: string, patch: Patch<T, T> }> updates];
			}
			return this.localPatch(updateArray);
		}
	}

	protected localPatch(updates: { id: string; patch: Patch<T, T> }[]): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		const action = createPatchAction(self.createUpdateFunction(self._patch, updates), updates, self);
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
		const action = createAddAction(self.createUpdateFunction(self._add, items), items, self);
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
		const action = createDeleteAction(self.createUpdateFunction(self._delete, ids), ids, self);
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
			return this.actionManager.queue(() => self._fetch(query));
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

	protected propagateUpdate(update: MultiUpdate<T>): void {
		switch (update.type) {
			case 'add':
				this.localAdd((<ItemsAdded<T>> update).updates.map(itemAdded => itemAdded.item));
				break;
			case 'update':
				this.localPut((<ItemsUpdated<T>> update).updates.map(itemUpdated => itemUpdated.item));
				break;
			case 'patch':
				this.localPatch((<ItemsUpdated<T>> update).updates.map(itemUpdated => ({
					id: this.getIds(itemUpdated.item)[0],
					patch: itemUpdated.diff()
				})));
				break;
			case 'delete':
				this.localDelete((<ItemsDeleted<T>> update).updates.map(itemDeleted => itemDeleted.id));
				break;
		}
	}

	protected buildMap(collection: T[], map?: ItemMap<T>): Promise<ItemMap<T>> {
		const self = <BaseStore<T>> this;
		const version = this.version;
		const _map = map || <ItemMap<T>> new Map();
		return Promise.resolve(this.getIds(...collection).reduce(function(_map, id, index) {
			if (_map.has(id) && !map) {
				throw new Error('Collection contains item with duplicate ID');
			}
			_map.set(id, {
				item: collection[index],
				index: index,
				updatedVersion: self.map.has(id) ? self.map.get(id).updatedVersion : version});
			return <ItemMap<T>> _map;
		}, _map));
	}

	protected getOptions(): BaseStoreOptions<T> {
		return {
			source: this.source || this,
			sourceQuery: this.sourceQuery
		};
	}

	public observe(): Observable<MultiUpdate<T>>;
	public observe(idOrIds: string | string[]): Observable<Update<T>>;
	public observe(idOrIds?: string | string[]): Observable<MultiUpdate<T>> | Observable<Update<T>> {
		if (idOrIds) {
			const ids: string[] = Array.isArray(idOrIds) ? <string[]> idOrIds : [<string> idOrIds];
			const self = <BaseStore<T>> this;
			return new Observable<Update<T>>(function subscribe(observer: Observer<Update<T>>) {
				const idSet = new Set<string>(ids);
				self.get(...ids).then((items: T[]) => {
					const retrievedIdSet = new Set<string>(self.getIds(...items));
					let missingItemIds: string[];
					if (retrievedIdSet.size !== idSet.size || (missingItemIds = ids.filter(id => !retrievedIdSet.has(id))).length) {
						observer.error(new Error(`ID(s) "${missingItemIds}" not found in store`));
					} else {
						const observerEntry: { observes: Set<string>; observer: Observer<Update<T>>} = {
							observes: idSet,
							observer: observer
						};
						(<string[]> ids).forEach(id => {
							if (self.itemObservers.has(id)) {
								self.itemObservers.get(id).push(observerEntry);
							} else {
								self.itemObservers.set(id, [observerEntry]);
							}
						});
						items.forEach((item, index) => observer.next(<ItemAdded<T>> {
							type: 'add',
							item: item,
							id: ids[index]
						}));
					}
				});
			});
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

	protected sendUpdates(resultObservable: Observable<StoreActionResult<T>>): Observable<StoreActionResult<T>> {
		const self = <BaseStore<T>> this;
		resultObservable.subscribe(function(result) {
			const update = result.successfulData;
			self.observers.forEach((observer: Observer<MultiUpdate<T>>) => observer.next(update));
			while (self.removeObservers.length) {
				self.observers.splice(self.removeObservers.pop(), 1);
			}
			const ids = update.updates.map(update => update.id);
			ids.forEach((id, index) => {
				if (self.itemObservers.has(id)) {
					self.itemObservers.get(id).forEach(observerEntry => observerEntry.observer.next(update.updates[index]));
				}
			});
			if (self.map) {
				ids.forEach((id) => {
					if (self.map.has(id)) {
						self.map.get(id).updatedVersion = self.version;
					}
				});
			}
		});
		return resultObservable;
	}

	protected cancelItems(resultObservable: Observable<StoreActionResult<T>>): Observable<StoreActionResult<T>> {
		const self: BaseStore<T> = this;
		resultObservable.subscribe(function(result) {
			self.observers.forEach((observer: Observer<MultiUpdate<T>>) => observer.next(result.successfulData));
			while (self.removeObservers.length) {
				self.observers.splice(self.removeObservers.pop(), 1);
			}
			result.successfulData.updates.map(update => {
				const id = update.id;
				if (self.itemObservers.has(id)) {
					self.itemObservers.get(id).forEach(observerEntry => {
						observerEntry.observes.delete(id);
						observerEntry.observer.next(update);
						if (!observerEntry.observes.size) {
							observerEntry.observer.complete();
						}
					});
					self.itemObservers.delete(id);
				}
			});
		});
		return resultObservable;
	}

	protected createUpdateFunction<U extends StoreActionDatum<T>>(
		updateFn: StoreUpdateDataFunction<T, U>,
		data: StoreActionData<T, U>,
		targetedVersion?: number): () => Promise<StoreUpdateResult<T, U>> {
		const self = <BaseStore<T>> this;
		if (typeof targetedVersion === 'undefined') {
			targetedVersion = self.version;
		}
		return function(): Promise<StoreUpdateResult<T, U>> {
			const prefilteredData: FilteredData<T, U> = self.failOnDirtyData ?
				self.rejectDirtyData(data, targetedVersion) : { data: data };
			return updateFn.call(self, prefilteredData.data).then(function(this: Store<T>, resultData: StoreUpdateResultData<T, U>) {
				self.version++;
				resultData.successfulData.updates.forEach(update => {
					if (self.map.has(update.id)) {
						self.map.get(update.id).updatedVersion = self.version;
					}
				});
				return <StoreUpdateResult<T, U>> {
					currentItems: [ ...(prefilteredData.currentItems || []), ...(resultData.currentItems || []) ],
					failedData: [ ...(prefilteredData.failedData || []), ...(resultData.failedData || []) ],
					successfulData: resultData.successfulData,
					store: this,
					retry(failedData: StoreActionData<T, U>) {
						return self.createUpdateFunction(updateFn, failedData)();
					}
				};
			});
		};
	}

	protected rejectDirtyData<U extends StoreActionDatum<T>> (
		data: StoreActionData<T, U>,
		targetedVersion: number): FilteredData<T, U> {
		const self = <BaseStore<T>> this;
		const ids: string[] = data.map(function(item: StoreActionDatum<T>) {
			if (typeof item === 'string') {
				return <string> item;
			} else if ((<any> item).id && (<any> item).patch && typeof (<any> item).id === 'string') {
				return <string> (<any> item).id;
			} else {
				return self.getIds(<T> item)[0];
			}
		});
		let currentItems: T[] = [];
		let newTargets: StoreActionData<T, U> = <StoreActionData<T, U>> data.filter((_, index) =>
			(!self.map.has(ids[index])) || (self.map.get(ids[index]).updatedVersion <= targetedVersion)
		);
		let outdatedData: StoreActionData<T, U> = <StoreActionData<T, U>> data.filter((_, index) => {
			const result = self.map.has(ids[index]) && self.map.get(ids[index]).updatedVersion > targetedVersion;
			if (result) {
				currentItems.push(self.map.get(ids[index]).item);
			}
			return result;
		});
		return {
			currentItems: currentItems.length ? currentItems : null,
			failedData: outdatedData.length ? outdatedData : null,
			data: newTargets
		};
	}
}
