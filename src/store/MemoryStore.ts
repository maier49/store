import Query, { QueryType } from '../query/Query';
import {BaseStore, BaseStoreOptions, ItemUpdated, ItemsUpdated, ItemsAdded, ItemsDeleted} from './Store';
import Promise from 'dojo-shim/Promise';
import {StoreUpdateFunction, StoreUpdateResult, StoreActionData} from '../storeActions/StoreAction';
import {diff, default as Patch} from '../patch/Patch';

export interface MemoryStoreOptions<T> extends BaseStoreOptions<T> {
	data?: T[];
	idProperty?: string;
	idFunction?: (item: T) => string;
}

export default class MemoryStore<T> extends BaseStore<T> {
	idProperty?: string;
	idFunction?: (item: T) => string;
	nextId = 1;
	data: T[];

	constructor(options?: MemoryStoreOptions<T>) {
		super(options);
		options = options || {};
		this.data = options.data || [];
		this.idProperty = options.idProperty;
		this.idFunction = options.idFunction;
	}

	getIds(...items: T[]): string[] {
		if (this.idProperty) {
			return items.map(item => (<any> item)[this.idProperty]);
		} else if (this.idFunction) {
			return items.map(this.idFunction);
		} else {
			return items.map(item => (<any> item).id);
		}
	}

	generateId(): Promise<string> {
		return Promise.resolve(String(this.nextId++));
	}

	protected _fetch<V>(query?: Query<T, V>): Promise<T[]> {
		return Promise.resolve(query ? query.apply(this.data) : this.data);
	}

	protected _get(ids: string[]): Promise<T[]> {
		return Promise.resolve(ids.map(id => this.map.get(id).item).filter(item => item));
	}

	protected createPut(items: T[]): StoreUpdateFunction<T> {
		const self = <MemoryStore<T>> this;
		return () => {
			let dataPromise: Promise<void>;
			const failedItems: T[] = [];
			const currentItems: T[] = [];
			const unFilteredIds = this.getIds(...items);
			const filteredItems = items.filter(function(item, index) {
				const result = self.map.has(unFilteredIds[index]);
				if (!result) {
					failedItems.push(item);
					currentItems.push(null);
				}
				return result;
			});

			const filteredIds = this.getIds(...filteredItems);
			const oldItems =  filteredIds.map(id => self.map.get(id).item);
			const oldIndices = filteredIds.map(id => self.map.get(id).index);
			if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
				dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
					self.data = data;
				});
			} else {
				dataPromise = Promise.resolve();
				filteredItems.forEach((item, index) => self.data[oldIndices[index]] = item);
				self.data = self.sourceQuery ? self.sourceQuery.apply(self.data) : self.data;
			}

			return dataPromise.then(() => self.buildMap(self.data)).then(function(map) {
				self.map = map;
				const newIndices = filteredIds.map(id => self.map.get(id).index);
				const update: ItemsUpdated<T> = {
					type: 'update',
					updates: newIndices.map((newIndex, index) => (<ItemUpdated<T>> {
						index: newIndex,
						previousIndex: oldIndices[index],
						item: filteredItems[index],
						diff: () => diff(oldItems[index], filteredItems[index]),
						id: filteredIds[index]
					}))
				};

				return <StoreUpdateResult<T>> {
					successfulData: update,
					retry: (failedData: StoreActionData<T>) => self.actionManager.queue(
						self.wrapUpdateFunctionWithStaleCheck(
							self.createPut.bind(self),
							items,
							self.version
						)
					),
					failedData: failedItems.length ? failedItems : null,
					currentItems: failedItems.length ? currentItems : null,
					store: self
				};
			});
		};
	}

	protected createAdd(items: T[], indices?: number[]): StoreUpdateFunction<T> {
		const self = <MemoryStore<T>> this;
		return () => {
			let dataPromise: Promise<void>;
			const failedItems: T[] = [];
			const currentItems: T[] = [];
			const unFilteredIds = this.getIds(...items);
			const filteredItems = items.filter(function(item, index) {
				const result = !self.map.has(unFilteredIds[index]);
				if (!result) {
					failedItems.push(item);
					currentItems.push(self.map.get(unFilteredIds[index]).item);
				}
				return result;
			});

			const filteredIds = this.getIds(...filteredItems);
			if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
				dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
					self.data = data;
				});
			} else {
				dataPromise = Promise.resolve();
				self.data = self.sourceQuery ?
					self.sourceQuery.apply([ ...self.data, ...items ]) : [ ...self.data, ...items ];
			}

			return dataPromise.then(() => self.buildMap(self.data)).then(function(map) {
				self.map = map;
				const newIndices = filteredIds.map(id => self.map.get(id).index);
				const update: ItemsAdded<T> = {
					type: 'add',
					updates: newIndices.map((newIndex, index) => (<ItemUpdated<T>> {
						index: newIndex,
						item: filteredItems[index],
						id: filteredIds[index]
					}))
				};

				return <StoreUpdateResult<T>> {
					successfulData: update,
					retry: (items: T[]) => self.actionManager.queue(
						self.wrapUpdateFunctionWithStaleCheck(
							self.createAdd.bind(self),
							items,
							self.version
						)
					),
					failedData: failedItems.length ? failedItems : null,
					currentItems: failedItems.length ? currentItems : null,
					store: self
				};
			});
		};
	}

	protected createDelete(ids: string[]): StoreUpdateFunction<T> {
		const self = <MemoryStore<T>> this;
		return () => {
			const localIds = self.getIds(...self.data);
			let earliestDelete = Infinity;

			let successfulUpdates: { index: number, id: string }[] = [];
			let failedData: string[] = [];
			ids.forEach(id => {
				if (self.map.has(id)) {
					const index = self.map.get(id).index;
					successfulUpdates.push({
						index: index,
						id: id
					});
					earliestDelete = Math.min(earliestDelete, index);
					self.map.delete(id);
					localIds.splice(index, 1);
					self.data.splice(index, 1);
				} else {
					failedData.push(id);
				}
			});

			for (let i = earliestDelete; i < self.data.length; i++) {
				self.map.get(localIds[i]).index = i;
			}

			const update: ItemsDeleted<T> = {
				type: 'delete',
				updates: successfulUpdates.map(({ index, id }: { index: number; id: string; }) => ({
					id: id,
					index: index
				}))
			};
			return Promise.resolve({
				successfulData: update,
				failedData: failedData,
				retry: (ids: string[]) => self.actionManager.queue(
					self.wrapUpdateFunctionWithStaleCheck(
						self.createDelete.bind(self),
						ids,
						self.version
					)
				),
				store: self
			});
		};
	}

	protected createPatch(updates: { id: string; patch: Patch<T, T> }[]): StoreUpdateFunction<T> {
		const self = <MemoryStore<T>> this;
		return () => {
			let dataPromise: Promise<void>;
			const failedItems: { id: string; patch: Patch<T, T> }[] = [];
			const currentItems: T[] = [];
			const filteredUpdates = updates.filter(function(update) {
				const result = self.map.has(update.id);
				if (!result) {
					failedItems.push(update);
					currentItems.push(null);
				}
				return result;
			});

			const oldIndices = filteredUpdates.map(update => self.map.get(update.id).index);
			if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
				dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
					self.data = data;
				});
			} else {
				dataPromise = Promise.resolve();
				filteredUpdates.forEach((update, index) => update.patch.apply(self.data[oldIndices[index]]));
				self.data = self.sourceQuery ? self.sourceQuery.apply(self.data) : self.data;
			}

			return dataPromise.then(() => self.buildMap(self.data)).then(function(map) {
				self.map = map;
				const newIndices = filteredUpdates.map(update => self.map.get(update.id).index);
				const update: ItemsUpdated<T> = {
					type: 'update',
					updates: newIndices.map((newIndex, index) => (<ItemUpdated<T>> {
						index: newIndex,
						previousIndex: oldIndices[index],
						item: self.data[newIndex],
						diff: () => filteredUpdates[index].patch,
						id: filteredUpdates[index].id
					}))
				};

				return {
					successfulData: update,
					retry: (updates: { id: string; patch: Patch<T, T> }[]) => self.actionManager.queue(
						self.wrapUpdateFunctionWithStaleCheck(
							self.createPatch.bind(self),
							updates,
							self.version
						)
					),
					failedData: failedItems.length ? failedItems : null,
					currentItems: failedItems.length ? currentItems : null,
					store: self
				};
			});
		};
	}

	protected isUpdate(item: T): Promise<{ isUpdate: boolean; item: T; id: string }> {
		const id = this.getIds(item)[0];
		const isUpdate = this.map.has(id);
		return Promise.resolve({
			id: id,
			item: item,
			isUpdate: isUpdate
		});
	}
}
