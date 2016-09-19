import Query, { CompoundQuery } from '../query/Query';
import Patch from '../patch/Patch';
import Filter, { createFilter } from '../query/Filter';
import Promise from 'dojo-shim/Promise';
import WeakMap from 'dojo-shim/WeakMap';
import Set from 'dojo-shim/Set';
import Map from 'dojo-shim/Map';
import { after } from 'dojo-core/aspect';
import compose, { ComposeFactory } from 'dojo-compose/compose';
import { Observer, Observable, Subscription } from 'rxjs';
import { Sort, createSort } from '../query/Sort';
import StoreRange, { createRange } from '../query/StoreRange';
import { QueryType } from '../query/Query';
import { duplicate } from 'dojo-core/lang';
import { Transaction, SimpleTransaction } from './Transaction';
import StoreActionManager from '../storeActions/StoreActionManager';
import {
	StoreActionResult, StoreUpdateFunction, StoreUpdateResult, createPutAction, createPatchAction, createAddAction,
	createDeleteAction, StoreActionDatum, StoreActionData, StoreUpdateDataFunction, UpdateResults, StoreAction,
	FilteredData
} from '../storeActions/StoreAction';
import {AsyncPassiveActionManager} from '../storeActions/StoreActionManager';
import createInMemoryStorage from '../storage/createInMemoryStorage';
import {diff} from '../patch/Patch';
import {PatchMapEntry} from '../patch/Patch';

export const enum StoreOperation {
	Add,
	Put,
	Patch,
	Delete
}

export type ItemEntry<T> = {
	item: T;
	index: number;
	updatedVersion: number;
}

export type ItemMap<T> = Map<string, ItemEntry<T>>;

export interface Update<T> {
	type: StoreOperation;
	id: string;
	item?: T;
	index?: number;
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
}

export interface MultiUpdate<T> {
	type: StoreOperation;
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

export interface StoreObservable<T> extends Observable<StoreActionResult<T>> {
	then<U>(onFulfilled?: ((value?: T[] | string[]) => (U | Promise<U> | null | undefined)) | null | undefined, onRejected?: (reason?: Error) => void): Promise<U>;
}

export function createStoreObservable<T>(observable: Observable<StoreActionResult<T>>): StoreObservable<T> {
	(<any> observable).then = function(...args: any[]) {
		return (<any> observable.toPromise().then(function(result) {
			if (!result.successfulData) {
				throw new Error('All data failed to update due to conflicts');
			}

			return result.successfulData;
		}).then)(...args);
	};

	return <StoreObservable<T>> observable;
}

export interface Store<T, O> {
	get(ids: string[] | string): Promise<T[]>;
	getIds(items: T[] | T): string[];
	generateId(): Promise<string>;
	add(items: T[] | T, options?: O): StoreObservable<T>;
	put(items: T[] | T, options?: O): StoreObservable<T>;
	patch(updates: Map<string, Patch<T, T>> | { id: string; patch: Patch<T, T> } | { id: string; patch: Patch<T, T> }[], options?: O): StoreObservable<T>;
	delete(ids: string[] | string): StoreObservable<T>;
	observe(): Observable<MultiUpdate<T>>;
	observe(ids: string | string[]): Observable<Update<T>>;
	release(actionManager?: StoreActionManager<T>): Promise<Store<T, O>>;
	track(): Promise<Store<T, O>>;
	fetch(): Promise<T[]>;
	fetch<U>(query: Query<T, U>): Promise<U[]>;
	query(query: Query<T, T>): Store<T, O>;
	filter(filter: Filter<T>): Store<T, O>;
	filter(test: (item: T) => boolean): Store<T, O>;
	createFilter(): Filter<T>;
	range(range: StoreRange<T>): Store<T, O>;
	range(start: number, count: number): Store<T, O>;
	sort(sort: Sort<T> | ((a: T, b: T) => number) | string, descending?: boolean): Store<T, O>;
	transaction(): Transaction<T, O>;
}

export interface Storage<T, O> {
	getIds(items: T[]): string[];
	generateId(): Promise<string>;
	fetch(): Promise<T[]>;
	fetch<V>(query?: Query<T, V>): Promise<V[]>;
	get(ids: string[]): Promise<T[]>;
	put(items: T[], options?: O): Promise<UpdateResults<T, T>>;
	add(items: T[], options?: O): Promise<UpdateResults<T, T>>;
	delete(ids: string[]): Promise<UpdateResults<T, string>>;
	patch(updates: { id: string; patch: Patch<T, T> }[], options?: O): Promise<UpdateResults<T, T>>;
	isUpdate(item: T): Promise<{ isUpdate: boolean; item: T, id: string }>;
}

export interface StoreOptions<T, O> {
	source?: Store<T, O>;
	storage?: Storage<T, O>;
	data?: T[];
	sourceQuery?: Query<T, T>;
	failOnDirtyData?: boolean;
	idProperty?: string;
	idFunction?: (item: T) => string;
	actionManager?: StoreActionManager<T>;
}

export interface StorageOptions<T> extends Object {}

export interface StoreFactory extends ComposeFactory<Store<{}, {}>, StoreOptions<{}, {}>> {
	<T extends {}, O>(options?: StoreOptions<T, O>): Store<T, O>;
}

export interface StorageFactory extends ComposeFactory<Storage<{}, {}>, StorageOptions<{}>> {
	<T extends {}, O>(options?: StorageOptions<T>): Storage<T, O>;
}

interface BaseStoreState<T, O> {
	failOnDirtyData?: boolean;
	source?: Store<T, O>;
	storage?: Storage<T, O>;
	sourceSubscription?: Subscription;
	sourceQuery?: CompoundQuery<any, T>;
	StoreFactory?: <T, O>(options?: StoreOptions<T, O>) => Store<T, O>;
	map?: ItemMap<T>;
	data?: T[];
	isTracking?: boolean;
	itemObservers?: Map<string, { observes: Set<string>; observer: Observer<Update<T>> }[]>;
	observers?: Observer<MultiUpdate<T>>[];
	actionManager?: StoreActionManager<T>;
	removeObservers?: number[];
	observable?: Observable<MultiUpdate<T>>;
	version: number;
}

const instanceStateMap = new WeakMap<Store<{}, {}>, BaseStoreState<{}, {}>>();

function rejectDirtyData<T, O, U extends StoreActionDatum<T>> (
	instance: Store<T, O>,
	instanceState: BaseStoreState<T, O>,
	data: StoreActionData<T, U>,
	targetedVersion: number,
	isAdd?: boolean): FilteredData<T, U> {
	const ids: string[] = data.map(function(item: StoreActionDatum<T>) {
		if (typeof item === 'string') {
			return <string> item;
		} else if ((<any> item).id && (<any> item).patch && typeof (<any> item).id === 'string') {
			return <string> (<any> item).id;
		} else {
			return instance.getIds(<T> item)[0];
		}
	});
	let currentItems: T[] = [];
	let newTargets: StoreActionData<T, U> = <StoreActionData<T, U>> data.filter(function(_, index) {
		return (!instanceState.map.has(ids[index])) || (!isAdd && instanceState.map.get(ids[index]).updatedVersion <= targetedVersion);
	});
	let outdatedData: StoreActionData<T, U> = <StoreActionData<T, U>> data.filter(function(_, index) {
		const result = instanceState.map.has(ids[index]) && instanceState.map.get(ids[index]).updatedVersion > targetedVersion;
		if (result) {
			currentItems.push(instanceState.map.get(ids[index]).item);
		}
		return result;
	});
	return {
		currentItems: currentItems.length ? currentItems : null,
		failedData: outdatedData.length ? outdatedData : null,
		data: newTargets
	};
}

function createUpdateFunction<T, O, U extends StoreActionDatum<T>>(
	instance: Store<T, O>,
	instanceState: BaseStoreState<T, O>,
	updateFn: StoreUpdateDataFunction<T, U>,
	data: StoreActionData<T, U>,
	options?: O,
	retryUpdateFn?: StoreUpdateDataFunction<T, U>,
	targetedVersion?: number,
	isAdd?: boolean,
): () => Promise<StoreUpdateResult<T, U>> {
	if (typeof targetedVersion === 'undefined') {
		targetedVersion = instanceState.version;
	}
	return function(): Promise<StoreUpdateResult<T, U>> {
		const prefilteredData: FilteredData<T, U> = (instanceState.failOnDirtyData || isAdd) ?
			rejectDirtyData(instance, instanceState, data, targetedVersion, isAdd) : { data: data };
		return updateFn.call(instanceState, prefilteredData.data, options).then(function(results: UpdateResults<T, U>) {
			instanceState.version++;
			return <StoreUpdateResult<T, U>> {
				currentItems: [ ...(prefilteredData.currentItems || []), ...(results.failedData || []) ],
				failedData: [ ...(prefilteredData.failedData || []), ...(results.failedData || []) ],
				successfulData: results.successfulData,
				retry(failedData: StoreActionData<T, U>) {
					return instanceState.actionManager.retry(
						createUpdateFunction(instance, instanceState, retryUpdateFn || updateFn, failedData, options)
					);
				}
			};
		});
	};
}

function getOptions<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>): StoreOptions<T, O> {
	return {
		source: instanceState.source || instance,
		sourceQuery: instanceState.sourceQuery
	};
}

function buildMap<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>,  collection: T[], map?: ItemMap<T>): Promise<ItemMap<T>> {
	const version = instanceState.version;
	const _map = map || <ItemMap<T>> new Map();
	return Promise.resolve(instance.getIds(collection).reduce(function(_map, id, index) {
		if (_map.has(id) && !map) {
			throw new Error('Collection contains item with duplicate ID');
		}
		_map.set(id, {
			item: collection[index],
			index: index,
			updatedVersion: instanceState.map.has(id) ? instanceState.map.get(id).updatedVersion : version});
		return <ItemMap<T>> _map;
	}, _map));
}

function sendUpdates<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, resultObservable: Observable<StoreActionResult<T>>) {
	resultObservable.subscribe(function(result) {
		if (result.successfulData) {
			const ids = typeof result.successfulData[0] === 'string' ? <string[]> result.successfulData : null;
			const items = typeof result.successfulData[0] !== 'string' ? <T[]> result.successfulData : null;
			transformUpdates(instance, instanceState, result.type, items, ids).then(function(update: BatchUpdate<T>) {
				instanceState.observers.forEach((observer: Observer<MultiUpdate<T>>) => observer.next(update));
				while (instanceState.removeObservers.length) {
					instanceState.observers.splice(instanceState.removeObservers.pop(), 1);
				}
				const ids = update.updates.map(function(update: Update<T>) {
					return update.id;
				});
				ids.forEach(function(id, index) {
					if (instanceState.itemObservers.has(id)) {
						instanceState.itemObservers.get(id).forEach(observerEntry => observerEntry.observer.next(update.updates[index]));
					}
				});
				if (instanceState.map) {
					ids.forEach(function(id) {
						if (instanceState.map.has(id)) {
							instanceState.map.get(id).updatedVersion = instanceState.version;
						}
					});
				}
			});
		}
	});
	return resultObservable;
}

function combinePutUpdateFunctions<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, items: T[], options?: O): StoreUpdateFunction<T, T> {
	const version = instanceState.version;
	return function() {
		const updatesOrAdds = Promise.all(items.map(function(item) {
			return instanceState.storage.isUpdate(item);
		}));
		return Promise.all([
			updatesOrAdds
				.then(function(updateCandidates: { isUpdate: boolean; item: T; id: string }[]): T[] {
					return updateCandidates
						.filter(x => x.isUpdate)
						.map(isUpdate => isUpdate.item);
				}).then(function(updates: T[]) {
				return updates.length ?
					createUpdateFunction(instance, instanceState, instanceState.storage.put, updates, options, null, version) : () => Promise.resolve({
					successfulData: {}
				});
			}),
			updatesOrAdds
				.then(function(addCandidates: { isUpdate: boolean; item: T; id: string }[]) {
					return addCandidates
						.filter(x => !x.isUpdate)
						.map(isUpdate => isUpdate.item);
				}).then(function(adds: T[]) {
				return adds.length ?
					createUpdateFunction(instance, instanceState, instanceState.storage.add, adds, options, null, version) : () => Promise.resolve({
					successfulData: {}
				});
			})
		]).then(function([ putUpdateFunction, addUpdateFunction ]: StoreUpdateFunction<T, T>[]) {
			return Promise.all([ putUpdateFunction(), addUpdateFunction() ])
				.then(function([ putResults, addResults ]: StoreUpdateResult<T, T>[]) {
					return {
						currentItems: (putResults.currentItems || addResults.currentItems) ?
							[ ...(putResults.currentItems || []), ...(addResults.currentItems || [])] : null,
						failedData: (putResults.failedData || addResults.failedData) ?
							[ ...(putResults.failedData || []), ...(addResults.failedData || [])] : null,
						successfulData: <string[] | T[]> [ ...putResults.successfulData, ...addResults.successfulData],
						store: instance,
						retry(failedData: T[]) {
							return combinePutUpdateFunctions(instance, instanceState, failedData)();
						}
					};
				});
		});
	};
}

function cancelItems<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, resultObservable: Observable<StoreActionResult<T>>) {
	resultObservable.subscribe(function(result) {
		if (result.successfulData) {
			const ids = typeof result.successfulData[0] === 'string' ? <string[]> result.successfulData : null;
			const items = typeof result.successfulData[0] !== 'string' ? <T[]> result.successfulData : null;
			transformUpdates(instance, instanceState, result.type, items, ids).then(function(update: BatchUpdate<T>) {
				instanceState.observers.forEach(function(observer: Observer<MultiUpdate<T>>) {
					return observer.next(update);
				});
				while (instanceState.removeObservers.length) {
					instanceState.observers.splice(instanceState.removeObservers.pop(), 1);
				}
				update.updates.forEach(function(update) {
					const id = update.id;
					if (instanceState.itemObservers.has(id)) {
						instanceState.itemObservers.get(id).forEach(observerEntry => {
							observerEntry.observes.delete(id);
							observerEntry.observer.next(update);
							if (!observerEntry.observes.size) {
								observerEntry.observer.complete();
							}
						});
						instanceState.itemObservers.delete(id);
					}
				});
			});
		}
	});
	return resultObservable;
}

function setupUpdateAspects<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>) {
	after(instance, 'localPut', sendUpdates.bind(null, instance, instanceState));
	after(instance, 'localPatch', sendUpdates.bind(null, instance, instanceState));
	after(instance, 'localAdd', sendUpdates.bind(null, instance, instanceState));
	after(instance, 'localDelete', cancelItems.bind(null, instance, instanceState));
}

function queueActionAndCreateObservable<T, O>(instanceState: BaseStoreState<T, O>, action: StoreAction<T>) {
	if (instanceState.source) {
		// If this has a source the ordering of actions is controlled there so we just need to
		// execute the update that has been propagated back down.
		action.do();
	} else {
		instanceState.actionManager.queue(action);
	}
	return createStoreObservable(action.observable);
}

function localPut<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, items: T[], options?: O): StoreObservable<T> {
	const action = createPutAction(combinePutUpdateFunctions(
		instance,
		instanceState,
		items,
		options
	), items, function() {
		return instanceState.version;
	});
	return queueActionAndCreateObservable(instanceState, action);
}

function localPatch<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, updates: PatchMapEntry<T, T>[], options?: O): StoreObservable<T> {
	const action = createPatchAction(createUpdateFunction<T, O, PatchMapEntry<T, T>>(
		instance,
		instanceState,
		instanceState.storage.patch,
		updates,
		options
	), updates, function() {
		return instanceState.version;
	});
	return queueActionAndCreateObservable(instanceState, action);
}

function localAdd<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, items: T[], options?: O): StoreObservable<T> {
	const action = createAddAction(createUpdateFunction(
		instance,
		instanceState,
		instanceState.storage.add,
		items,
		options,
		instanceState.storage.put,
		null,
		true
	), items, function() {
		return instanceState.version;
	});
	return queueActionAndCreateObservable(instanceState, action);
}

function localDelete<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, ids: string[]): StoreObservable<T> {
	const updateFunction = createUpdateFunction<T, O, string>(
		instance,
		instanceState,
		instanceState.storage.delete,
		ids
	);
	const action = createDeleteAction(updateFunction, ids, function() {
		return instanceState.version;
	});
	return queueActionAndCreateObservable(instanceState, action);
}

function createSubcollection<T, O>(instanceState: BaseStoreState<T, O>, options: StoreOptions<T, O>): Store<T, O> {
	return instanceState.StoreFactory(options);
}

function propagateUpdate<T, O>(instance: Store<T, O>, instanceState: BaseStoreState<T, O>, update: MultiUpdate<T>): void {
	if (instanceState.isTracking) {
		switch (update.type) {
			case StoreOperation.Add:
				localAdd(instance, instanceState, (<ItemsAdded<T>> update).updates.map(itemAdded => itemAdded.item));
				break;
			case StoreOperation.Put:
				localPut(instance, instanceState, (<ItemsUpdated<T>> update).updates.map(itemUpdated => itemUpdated.item));
				break;
			case StoreOperation.Patch:
				localPatch(instance, instanceState, (<ItemsUpdated<T>> update).updates.map(itemUpdated => ({
					id: instance.getIds(itemUpdated.item)[0],
					patch: itemUpdated.diff()
				})));
				break;
			case StoreOperation.Delete:
				localDelete(instance, instanceState, (<ItemsDeleted<T>> update).updates.map(itemDeleted => itemDeleted.id));
				break;
		}
	} else {

	}
}
function transformUpdates<T, O>(
	instance: Store<T, O>,
	instanceState: BaseStoreState<T, O>,
	type: StoreOperation,
	items?: T[],
	ids?: string[]): Promise<BatchUpdate<T>> {
	items = items || [];
	ids = ids || instance.getIds(items);
	ids.forEach(function(id) {
		const updateEntry: ItemEntry<T> = instanceState.map.get(id);
		if (updateEntry) {
			updateEntry.updatedVersion = instanceState.version;
		}
	});
	if (instanceState.isTracking) {
		return trackUpdates(instance, instanceState, type, items, ids);
	} else {
		return Promise.resolve({
			type: type,
			updates: ids.map(function(id, index) {
				return {
					type: type,
					id: id,
					item: items[index]
				};
			})
		});
	}
}

function trackUpdates<T, O>(
	instance: Store<T, O>,
	instanceState: BaseStoreState<T, O>,
	type: StoreOperation,
	items: T[],
	ids: string[]): Promise<BatchUpdate<T>> {
	const previousIndices: { [ key: string ]: number } = {};
	const diffs: { [ key: string ]: () => Patch<T, T> } = {};
	items.map(function(item, index) {
		const id = ids[index];
		const oldEntry = instanceState.map.get(id);
		if (oldEntry) {
			const oldItem = oldEntry.item;
			previousIndices[id] = oldEntry.index;
			diffs[id] = () => diff(oldItem, item);
		}
	});

	let newDataPromise: Promise<T[]>;
	if (instanceState.sourceQuery && !instanceState.sourceQuery.incremental) {
		if (instanceState.source) {
			newDataPromise = instanceState.source.fetch(instanceState.sourceQuery);
		} else {
			newDataPromise = instanceState.storage.fetch(instanceState.sourceQuery);
		}
	} else {
		newDataPromise = Promise.resolve(applyUpdates(instanceState, type, items, ids));
	}

	return newDataPromise.then(function(unsortedData) {
		return buildMap(instance, instanceState, unsortedData);
	}).then(function(map) {
		instanceState.map = map;
		return {
			type: type,
			updates: ids.map(function(id, index) {
				return {
					type: type,
					index: instanceState.map.has(id) ? instanceState.map.get(id).index : null,
					previousIndex: previousIndices[id],
					item: items[index],
					id: id,
					diff: diffs[id]
				};
			})
		};
	});
}

function applyUpdates<T, O>(instanceState: BaseStoreState<T, O>, type: StoreOperation, items: T[], ids: string[]): T[] {
	const toDelete: number[] = [];
	items.forEach(function(item, index) {
		switch (type) {
			case StoreOperation.Add:
				instanceState.data.push(item);
				break;
			case StoreOperation.Put:
			case StoreOperation.Patch:
				const updateEntry = instanceState.map.get(ids[index]);
				if (updateEntry) {
					instanceState.data[updateEntry.index] = item;
				} else {
					instanceState.data.push(item);
				}
				break;
			case StoreOperation.Delete:
				const deleteEntry = instanceState.map.get(ids[index]);
				if (deleteEntry) {
					toDelete.push(deleteEntry.index);
				}
				break;
		}
	});
	toDelete.sort().forEach(function(index) {
		instanceState.data.splice(index, 1);
	});
	return instanceState.sourceQuery ? instanceState.sourceQuery.apply(instanceState.data) : instanceState.data;
}

const createMemoryStore: StoreFactory = compose<Store<{}, {}>, StoreOptions<{}, {}>>({
	get(this: Store<{}, {}>, ids: string[] | string): Promise<{}[]> {
		const state = instanceStateMap.get(this);
		if (state.source) {
			return state.source.get(ids);
		} else {
			return state.actionManager.queue((): Promise<{}[]> => {
				return state.storage.get(Array.isArray(ids) ? <string[]> ids : [ <string> ids ]);
			});
		}
	},

	getIds(this: Store<{}, {}>, items: {}[] | {}) {
		return instanceStateMap.get(this).storage.getIds(Array.isArray(items) ? <{}[]> items : [ <{}> items ]);
	},

	generateId(this: Store<{}, {}>) {
		return instanceStateMap.get(this).storage.generateId();
	},

	createFilter(): Filter<{}> {
		return createFilter<{}>();
	},

	add(this: Store<{}, {}>, items: {}[] | {}, options?: {}): StoreObservable<{}> {
		const state = instanceStateMap.get(this);
		if (state.source) {
			return state.source.add(items);
		} else {
			return localAdd(this, state, Array.isArray(items) ? <{}[]> items : [ <{}> items ], options);
		}
	},

	put(this: Store<{}, {}>, items: {}[] | {}, options?: {}): StoreObservable<{}> {
		const state = instanceStateMap.get(this);
		if (state.source) {
			return state.source.put(items, options);
		} else {
			return localPut(this, state, Array.isArray(items) ? <{}[]> items : [ <{}> items ], options);
		}
	},

	patch(this: Store<{}, {}>, updates: { id: string; patch: Patch<{}, {}> } | Array<{ id: string; patch: Patch<{}, {}> }> | Map<string, Patch<{}, {}>>, options?: {}): StoreObservable<{}> {
		const state = instanceStateMap.get(this);
		if (state.source) {
			return state.source.patch(updates, options);
		} else {
			let updateArray: Array<{ id: string; patch: Patch<{}, {}> }>;
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
				updateArray = <Array<{ id: string; patch: Patch<{}, {}> }>> updates;
			} else {
				updateArray = [ <{ id: string, patch: Patch<{}, {}> }> updates ];
			}
			return localPatch(this, state, updateArray, options);
		}
	},

	delete(this: Store<{}, {}>, ids: string[] | string): StoreObservable<{}> {
		const state = instanceStateMap.get(this);
		if (state.source) {
			return state.source.delete(ids);
		} else {
			return localDelete(this, state, Array.isArray(ids) ? <string[]> ids : [ <string> ids ]);
		}
	},

	observe(this: Store<{}, {}>, idOrIds?: string | string[]): any {
		const self = this;
		const state = instanceStateMap.get(this);
		if (idOrIds) {
			const ids: string[] = Array.isArray(idOrIds) ? <string[]> idOrIds : [ <string> idOrIds ];
			return new Observable<Update<{}>>(function subscribe(observer: Observer<Update<{}>>) {
				const idSet = new Set<string>(ids);
				self.get(ids).then(function(items: {}[]) {
					const retrievedIdSet = new Set<string>(self.getIds(items));
					let missingItemIds = ids.filter(id => !retrievedIdSet.has(id));
					if (retrievedIdSet.size !== idSet.size || missingItemIds.length) {
						observer.error(new Error(`ID(s) "${missingItemIds}" not found in store`));
					} else {
						const observerEntry: { observes: Set<string>; observer: Observer<Update<{}>>} = {
							observes: idSet,
							observer: observer
						};
						(<string[]> ids).forEach(id => {
							if (state.itemObservers.has(id)) {
								state.itemObservers.get(id).push(observerEntry);
							} else {
								state.itemObservers.set(id, [ observerEntry ]);
							}
						});
						items.forEach((item, index) => observer.next(<ItemAdded<any>> {
							type: StoreOperation.Add,
							item: item,
							id: ids[index]
						}));
					}
				});
			});
		} else {
			return state.observable;
		}
	},

	release(this: Store<{}, {}>, actionManager?: StoreActionManager<{}>): Promise<Store<{}, {}>> {
		const self = this;
		const state = instanceStateMap.get(self);
		state.actionManager = state.actionManager || actionManager;
		if (state.source) {
			if (state.sourceSubscription) {
				state.sourceSubscription.unsubscribe();
				state.sourceSubscription = null;
			}
			return self.fetch().then(function(data: {}[]) {
				state.data = data.map(function(item) {
					return duplicate(item);
				});
				state.storage = instanceStateMap.get(state.source).storage;
				state.source = null;
				state.isTracking = false;
				return self;
			});
		} else {
			return Promise.resolve(self);
		}
	},

	track(this: Store<{}, {}>): Promise<Store<{}, {}>> {
		const self = this;
		const state = instanceStateMap.get(self);
		if (state.source) {
			if (state.sourceSubscription) {
				state.sourceSubscription.unsubscribe();
			}
			state.sourceSubscription = state.source.observe().subscribe(function(update: MultiUpdate<{}>) {
				propagateUpdate(self, state, update);
			});
		}

		return self.fetch().then(function() {
			state.isTracking = true;
			return self;
		});
	},

	fetch<V>(this: Store<{}, {}>, query?: Query<{}, V>): Promise<V[]> | Promise<{}[]> {
		const self = this;
		const state = instanceStateMap.get(this);
		if (state.sourceQuery) {
			query = query ? state.sourceQuery.withQuery(query) : <any> state.sourceQuery;
		}
		let dataPromise: Promise<{}[]>;
		if (state.source) {
			dataPromise = state.source.fetch(query);
		} else {
			dataPromise = state.actionManager.queue(function() {
				return state.storage.fetch(query);
			});
		}

		return dataPromise.then(function(data: {}[]) {
			state.data = data;
			if (state.isTracking) {
				return buildMap(self, state, state.data).then(function(map: ItemMap<{}>) {
					state.map = map;
					return state.data;
				});
			} else {
				return state.data;
			}
		});
	},

	query(this: Store<{}, {}>, query: Query<{}, {}>) {
		const state = instanceStateMap.get(this);
		const options = getOptions(this, state);
		if (options.sourceQuery) {
			const compoundQuery: CompoundQuery<{}, {}> = options.sourceQuery instanceof CompoundQuery ?
				<CompoundQuery<{}, {}>> options.sourceQuery : new CompoundQuery(options.sourceQuery);
			options.sourceQuery = compoundQuery.withQuery(query);
		} else {
			options.sourceQuery = query;
		}

		return createSubcollection(state, options);
	},

	filter(this: Store<{}, {}>, filterOrTest: Filter<{}> | ((item: {}) => boolean)) {
		let filter: Filter<{}>;
		if (isFilter(filterOrTest)) {
			filter = filterOrTest;
		} else {
			filter = this.createFilter().custom(<(item: {}) => boolean> filterOrTest);
		}

		return this.query(filter);
	},

	range(this: Store<{}, {}>, rangeOrStart: StoreRange<{}> | number, count?: number) {
		let range: StoreRange<{}>;
		if (typeof count !== 'undefined') {
			range = createRange<{}>(<number> rangeOrStart, count);
		} else {
			range = <StoreRange<{}>> rangeOrStart;
		}

		return this.query(range);
	},

	sort(this: Store<{}, {}>, sortOrComparator: Sort<{}> | ((a: {}, b: {}) => number), descending?: boolean) {
		let sort: Sort<{}>;
		if (isSort(sortOrComparator)) {
			sort = sortOrComparator;
		} else {
			sort = createSort(sortOrComparator, descending);
		}

		return this.query(sort);
	},

	transaction(this: Store<{}, {}>): Transaction<{}, {}> {
		return new SimpleTransaction<{}, {}>(this);
	}
}, <T, O>(instance: Store<T, O>, options: StoreOptions<T, O>) => {
	options = options || {};
	const instanceState = <BaseStoreState<T, O>> {
		source: options.source,
		version: 1
	};
	if (!instanceState.source) {
		instanceState.storage = options.storage || createInMemoryStorage({
			idFunction: options.idFunction,
			idProperty: options.idProperty
		});
	}
	instanceState.map = new Map<string, ItemEntry<T>>();
	instanceState.itemObservers = new Map<string, { observes: Set<string>; observer: Observer<Update<T>> }[]>();
	instanceState.observers = [];
	instanceState.removeObservers = [];
	instanceState.observable = new Observable<MultiUpdate<T>>(
		function(this: Store<T, O>, observer: Observer<MultiUpdate<T>>) {
			instanceState.observers.push(observer);
			return () => {
				return instanceState.removeObservers.push(instanceState.observers.indexOf(observer));
			};
		}
	);
	if (options.sourceQuery) {
		instanceState.sourceQuery = new CompoundQuery(options.sourceQuery);
	}

	if (instanceState.source) {
		instanceState.version = instanceStateMap.get(instanceState.source).version - 1;
		instanceState.sourceSubscription = instanceState.source.observe().subscribe(function(sourceUpdate: BatchUpdate<T>) {
			const ids = sourceUpdate.updates.map(function(update) {
				return update.id;
			});
			const items = sourceUpdate.updates.map(function(update) {
				return update.item;
			});
			let updatePromise: Promise<BatchUpdate<T>> = transformUpdates(instance, instanceState, sourceUpdate.type, items, ids);

			updatePromise.then(function(update) {
				instanceState.observers.forEach(function(observer: Observer<MultiUpdate<{}>>) {
					observer.next(update);
				});
			});
		});
	}

	instanceState.StoreFactory = createMemoryStore;
	instanceState.actionManager = options.actionManager || new AsyncPassiveActionManager<T>();
	instanceState.failOnDirtyData = options.failOnDirtyData;
	instanceStateMap.set(instance, instanceState);

	setupUpdateAspects(instance, instanceState);
});

export default createMemoryStore;
