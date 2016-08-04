// import Query from './Query';
// import { Patch, diff, createPatch } from '../patch/Patch';
// import filterFactory from './Filter';
// import {Store, BaseStore, StoreOptions, ItemUpdated} from './Store';
// import Promise from 'dojo-shim/Promise';
// import Map from 'dojo-shim/Map';
// import { duplicate } from 'dojo-core/lang';
// import {QueryType} from './query';
//
// function isRange(query: Query<any>): query is Range {
// 	return query.queryType === QueryType.Range;
// }
//
// export interface MemoryOptions<T, U extends Store<T>> extends StoreOptions<T, U> {
// 	data?: T[];
// 	map?: Map<string, { item: T; index: number }>;
// 	version?: number;
// }
//
// export class MemoryStore<T> extends BaseStore<T, MemoryStore<T>> {
// 	constructor(options?: MemoryOptions<T, MemoryStore<T>>) {
// 		super();
// 		this.data = options.data || [];
// 		if (!this.source) {
// 			this.map = options.map || {};
// 			this.buildMap(this.data, this.map);
// 		}
// 	}
//
// 	_get(...ids: string[]): Promise<T[]> {
// 		return Promise.resolve(ids.map(function(id: string) {
// 			return duplicate(this.map[id].item);
// 		}));
// 	}
//
// 	_put(itemsOrPatches: (T | Map<string, Patch>)[]): Promise<ItemUpdated<T>[]> {
// 		const self = this;
// 		const areItems = itemsOrPatches[0] && itemsOrPatches[0].toString() !== 'Map';
// 		let updates: ItemUpdated<T>[];
// 		const hasRangeQuery = (this.source && this.queries.some(isRange));
// 		if (areItems) {
// 			updates = (<T[]> itemsOrPatches).map(function(item) {
// 				const id = this.getIds(item)[0];
// 				const mapEntry = this.map[id];
// 				const oldItem = mapEntry.item;
// 				const oldIndex = mapEntry.index;
// 				const _diff = () => diff(oldItem, item);
//
// 				this.data[mapEntry.index] = item;
// 				return <ItemUpdated<T>> {
// 					item: item,
// 					oldINdex: oldIndex,
// 					diff: _diff,
// 					type: 'update'
// 				};
// 			}, this);
// 		} else {
// 			const patchMap: Map<string, Patch> = (<Map<string, Patch>[]> itemsOrPatches).reduce((prev, next: Map<string, Patch>) => {
// 				next.keys().forEach(function(key) {
// 					if (prev.has(key)) {
// 						prev.put(key, createPatch([ ...prev.get(key).operations, ...next.get(key).operations ]));
// 					} else {
// 						prev.put(key, next.get(key));
// 					}
// 				});
// 				return prev;
// 			}, new Map<string, Patch>());
//
// 			updates = patchMap.keys().map(function(id) {
// 				const mapEntry = this.map[id];
// 				const oldIndex: number = mapEntry.index;
// 				const patch = patchMap.get(id);
// 				const item: T = hasRangeQuery ? this.source.map.get(id).item : patch.apply(mapEntry.item);
// 				const _diff = () =>  patchMap.get(id);
//
// 				this.data[mapEntry.index] = mapEntry.item = item;
// 				return <ItemUpdated<T>> {
// 					item: item,
// 					oldIndex: oldIndex,
// 					diff: _diff,
// 					type: 'update'
// 				};
// 			}, this);
// 		}
//
// 		let newData: Promise<T[]>;
// 		if (hasRangeQuery) {
// 			newData = this.source.fetch(this.queries);
// 		} else {
// 			newData = this._fetch(this.queries);
// 		}
// 		return newData.then(function(data: T[]) {
// 			self.data = data;
// 			return this.buildMap(this.data).then(function(map) {
// 				self.map = map;
// 				return updates.map(function(update) {
// 					const id = self.getId(update.item);
// 					if (map.has(id)) {
// 						update.index = map.get(id).index;
// 					}
// 					return update;
// 				}, self);
// 			});
// 		});
// 	}
//
// 	createFilter() {
// 		return filterFactory<T>();
// 	}
//
// 	getId(item: T) {
// 		return Promise.resolve((<any> item).id);
// 	}
//
// 	generateId() {
// 		return Promise.resolve('' + Math.random());
// 	}
//
// 	_add(item: T, index?: number): Promise<ItemAdded<T>> {
// 		return this.getId(item).then(function(id) {
// 			if (this.map[id]) {
// 				throw new Error('Item added to collection item with duplicate ID');
// 			}
// 			this.collection.push(item);
// 			this.map[id] = { item: item, index: this.collection.length - 1};
//
// 			return {
// 				item: this.map[id].item,
// 				index: this.map[id].index,
// 				type: 'add'
// 			};
// 		});
// 	}
//
// 	_getOptions(): MemoryOptions<T, MemoryStore<T>> {
// 		return {
// 			version: this.version
// 		};
// 	}
//
// 	_delete(id: string, index?: number): Promise<ItemDeleted> {
// 		this.version++;
// 		const mapEntry = this.map[id];
// 		delete this.map[id];
// 		this.collection.splice(mapEntry.index, 1);
// 		this.buildMap(this.collection.slice(mapEntry.index), this.map);
//
// 		return Promise.resolve({
// 			id: id,
// 			index: mapEntry.index,
// 			type: 'delete'
// 		});
// 	}
//
// 	handleUpdates(updates: Update<T>[]) {
// 	}
//
// 	_isUpdate(item: T) {
// 		return this.getId(item).then(function(id: string) {
// 			return this.map[id];
// 		}.bind(this));
// 	}
//
// 	_fetch(...queries: Query<T>[]) {
// 		return Promise.resolve(this.queries.reduce((prev, next) => next.apply(prev), this.data));
// 	}
// }
