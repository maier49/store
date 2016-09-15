import Query, { QueryType } from '../query/Query';
import {
	BaseStore, BaseStoreOptions, ItemUpdated, ItemsUpdated, ItemsAdded, ItemsDeleted, ItemDeleted,
	BatchUpdate
} from './Store';
import Promise from 'dojo-shim/Promise';
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
			this.add(options.data);
		}
		this.idProperty = options.idProperty;
		this.idFunction = options.idFunction;
	}

	getIds(items: T[]| T): string[] {
		const itemArray = Array.isArray(items) ? <T[]> items : [ <T> items ];
		if (this.idProperty) {
			return itemArray.map((item) => {
				return (<any> item)[this.idProperty];
			});
		} else if (this.idFunction) {
			return itemArray.map(this.idFunction);
		} else {
			return itemArray.map(function(item) {
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

	protected _put(items: T[], options?: {}): Promise<BatchUpdate<T>> {
		const self = <MemoryStore<T>> this;
		let dataPromise: Promise<void>;

		const filteredIds = this.getIds(items);
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
			items.forEach(function(item, index) {
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
						item: items[index],
						diff() {
							return diff(oldItems[index], items[index]);
						},
						id: filteredIds[index]
					});
				})
			};

			return  update;
		});
	}

	protected _add(items: T[], options?: {}): Promise<BatchUpdate<T>> {
		const self = <MemoryStore<T>> this;
		let dataPromise: Promise<void>;
		const unFilteredIds = this.getIds(items);
		const filteredItems = items.filter(function(item, index) {
			return !self.map.has(unFilteredIds[index]);
		});

		const filteredIds = this.getIds(filteredItems);
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

			return update;
		});
	}

	protected _delete(ids: string[]): Promise<BatchUpdate<T>> {
		const self = <MemoryStore<T>> this;
		let successfulUpdates: { index: number, id: string }[] = [];
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
			return update;
		});
	}

	protected _patch(updates: { id: string; patch: Patch<T, T> }[], options?: {}): Promise<BatchUpdate<T>> {
		const self = <MemoryStore<T>> this;
		let dataPromise: Promise<void>;
		const filteredUpdates = updates.filter(function(update) {
			return self.map.has(update.id);
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

			return update;
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
