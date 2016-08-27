import Query, { QueryType } from '../query/Query';
import { BaseStore, BaseStoreOptions, ItemUpdated, ItemsUpdated, ItemsAdded, ItemsDeleted, ItemDeleted } from './Store';
import Promise from 'dojo-shim/Promise';
import { StoreUpdateResultData } from '../storeActions/StoreAction';
import { diff, default as Patch } from '../patch/Patch';

export interface MemoryStoreOptions<T> extends BaseStoreOptions<T> {
	data?: T[];
	idProperty?: string;
	idFunction?: (item: T) => string;
}

export default class MemoryStore<T> extends BaseStore<T> {
	idProperty?: string;
	idFunction?: (item: T) => string;
	nextId = 1;
	data: T[] = [];

	constructor(options?: MemoryStoreOptions<T>) {
		super(options);
		options = options || {};
		if (options.data && options.data.length) {
			this.add(...options.data);
		}
		this.idProperty = options.idProperty;
		this.idFunction = options.idFunction;
	}

	getIds(...items: T[]): string[] {
		if (this.idProperty) {
			return items.map((item) => {
				return (<any> item)[this.idProperty];
			});
		} else if (this.idFunction) {
			return items.map(this.idFunction);
		} else {
			return items.map(function(item) {
				return (<any> item).id;
			});
		}
	}

	generateId(): Promise<string> {
		return Promise.resolve(String(this.nextId++));
	}

	protected _fetch<V>(query?: Query<T, V>): Promise<V[]> {
		const self = <MemoryStore<T>> this;
		return Promise.resolve(query ? query.apply(self.data) : self.data);
	}

	protected _get(ids: string[]): Promise<T[]> {
		const self = <MemoryStore<T>> this;
		return Promise.resolve(ids.map(id => self.map.has(id) ? self.map.get(id).item : null).filter(item => item));
	}

	protected _put(items: T[]): Promise<StoreUpdateResultData<T, T>> {
		const self = <MemoryStore<T>> this;
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
		const oldItems =  filteredIds.map(function(id) {
			return self.map.get(id).item;
		});
		const oldIndices = filteredIds.map(function(id) {
			return self.map.get(id).index;
		});
		if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
			dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
				self.data = data;
			});
		} else {
			dataPromise = Promise.resolve();
			filteredItems.forEach(function(item, index) {
				return self.data[oldIndices[index]] = item;
			});
			self.data = self.sourceQuery ? self.sourceQuery.apply(self.data) : self.data;
		}

		return dataPromise.then(function() {
			return self.buildMap(self.data);
		}).then(function(map) {
			self.map = map;
			const newIndices = filteredIds.map(id => self.map.get(id).index);
			const update: ItemsUpdated<T> = {
				type: 'update',
				updates: newIndices.map(function(newIndex, index) {
					return (<ItemUpdated<T>> {
						type: 'update',
						index: newIndex,
						previousIndex: oldIndices[index],
						item: filteredItems[index],
						diff() {
							return diff(oldItems[index], filteredItems[index]);
						},
						id: filteredIds[index]
					});
				})
			};

			return <StoreUpdateResultData<T, T>> {
				successfulData: update,
				failedData: failedItems.length ? failedItems : null,
				currentItems: failedItems.length ? currentItems : null
			};
		});
	}

	protected _add(items: T[]): Promise<StoreUpdateResultData<T, T>> {
		const self = <MemoryStore<T>> this;
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
				self.sourceQuery.apply([...self.data, ...filteredItems]) : [...self.data, ...filteredItems];
		}

		return dataPromise.then(() => self.buildMap(self.data)).then(function(map) {
			self.map = map;
			const newIndices = filteredIds.map(id => self.map.get(id).index);
			const update: ItemsAdded<T> = {
				type: 'add',
				updates: newIndices.map(function(newIndex, index) {
					return (<ItemUpdated<T>> {
						index: newIndex,
						item: filteredItems[index],
						id: filteredIds[index]
					});
				})
			};

			return <StoreUpdateResultData<T, T>> {
				successfulData: update,
				failedData: failedItems.length ? failedItems : null,
				currentItems: failedItems.length ? currentItems : null
			};
		});
	}

	protected _delete(ids: string[]): Promise<StoreUpdateResultData<T, string>> {
		const self = <MemoryStore<T>> this;
		let successfulUpdates: { index: number, id: string }[] = [];
		let failedData: string[] = [];
		let filteredIds: string[] = [];
		const indices: number[] = [];
		ids.forEach(function(id) {
			if (self.map.has(id)) {
				const index = self.map.get(id).index;
				successfulUpdates.push({
					index: index,
					id: id
				});
				indices.push(index);
				filteredIds.push(id);
			} else {
				failedData.push(id);
			}
		});
		let dataPromise: Promise<void>;
		if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
			dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
				self.data = data;
			});
		} else {
			dataPromise = Promise.resolve();
			indices.sort().forEach((index, indexArrayIndex) => {
				self.data.splice(index + indexArrayIndex, 1);
			});
		}

		return dataPromise.then(function() {
			return self.buildMap(self.data);
		}).then(function(map) {
			self.map = map;

			const update = <ItemsDeleted<T>> {
				type: 'delete',
				updates: successfulUpdates.map(function({ index, id }: { index: number; id: string; }) {
					return (<ItemDeleted> {
						type: 'delete',
						id: id,
						index: index
					});
				})
			};
			return <StoreUpdateResultData<T, string>> {
				successfulData: update,
				failedData: failedData
			};
		});
	}

	protected _patch(updates: { id: string; patch: Patch<T, T> }[]): Promise<StoreUpdateResultData<T, { id: string; patch: Patch<T, T> }>> {
		const self = <MemoryStore<T>> this;
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

		const oldIndices = filteredUpdates.map(function(update) {
			return self.map.get(update.id).index;
		});
		if (self.source && self.sourceQuery && self.sourceQuery.queryTypes.has(QueryType.Range)) {
			dataPromise = self.source.fetch(self.sourceQuery).then(function(data: T[]) {
				self.data = data;
			});
		} else {
			dataPromise = Promise.resolve();
			// If there is a source, the data has already been patched so we only need to sort it
			if (!self.source) {
				filteredUpdates.forEach(function(update, index) {
					return update.patch.apply(self.data[oldIndices[index]]);
				});
			}
			self.data = self.sourceQuery ? self.sourceQuery.apply(self.data) : self.data;
		}

		return dataPromise.then(function() {
			return self.buildMap(self.data);
		}).then(function(map) {
			self.map = map;
			const newIndices = filteredUpdates.map(function(update)  {
				return self.map.get(update.id).index;
			});
			const update: ItemsUpdated<T> = {
				type: 'patch',
				updates: newIndices.map(function(newIndex, index) {
					return (<ItemUpdated<T>> {
						type: 'patch',
						index: newIndex,
						previousIndex: oldIndices[index],
						item: self.data[newIndex],
						diff: function() {
							return filteredUpdates[index].patch;

						},
						id: filteredUpdates[index].id
					});
				})
			};

			return {
				successfulData: update,
				failedData: failedItems.length ? failedItems : null,
				currentItems: failedItems.length ? currentItems : null
			};
		});
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
