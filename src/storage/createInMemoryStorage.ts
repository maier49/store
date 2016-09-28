import { Query } from '../query/createQuery';
import { Storage, StorageOptions, StorageFactory, StoreOperation } from '../store/createMemoryStore';
import compose from 'dojo-compose/compose';
import Promise from 'dojo-shim/Promise';
import WeakMap from 'dojo-shim/WeakMap';
import Map from 'dojo-shim/Map';
import Patch from '../patch/Patch';
import { UpdateResults} from '../storeActions/StoreAction';

export interface InMemoryStorageOptions<T> extends StorageOptions<T> {
	idProperty?: string;
	idFunction?: (item: T) => string;
}

export interface InMemoryStorageState<T> {
	idProperty?: string;
	idFunction?: (item: T) => string;
	nextId?: number;
	data?: T[];
	index: Map<string, number>;
}

export interface InMemoryStorageUpdatePragma {
	rejectOverwrite?: boolean;
}

const instanceStateMap = new WeakMap<Storage<{}, {}>, InMemoryStorageState<{}>>();

export interface InMemoryStorageFactory extends StorageFactory {
	<T>(options?: InMemoryStorageOptions<T>): Storage<T, InMemoryStorageUpdatePragma>;
}

type IdObject = { [ index: string ]: string; id: string };

const createInMemoryStorage: InMemoryStorageFactory = compose<Storage<IdObject, InMemoryStorageUpdatePragma>, InMemoryStorageOptions<{}>>({
		getIds(this: Storage<{}, {}>, items: IdObject[]| IdObject): string[] {
			const state = instanceStateMap.get(this);
			const itemArray = Array.isArray(items) ? <IdObject []> items : [ <IdObject> items ];
			if (state.idProperty) {
				return itemArray.map((item) => {
					return item[state.idProperty];
				});
			}
			else if (state.idFunction) {
				return itemArray.map(state.idFunction);
			}
			else {
				return itemArray.map(function(item) {
					return item.id;
				});
			}
		},

		generateId(this: Storage<{}, {}>): Promise<string> {
			const state = instanceStateMap.get(this);
			return Promise.resolve(String(state.nextId++));
		},

		fetch<V>(this: Storage<{}, {}>, query?: Query<{}, V>): Promise<V[]> {
			const state = instanceStateMap.get(this);
			return Promise.resolve(query ? query.apply(state.data) : state.data);
		},

		get(this: Storage<{}, {}>, ids: string[]): Promise<{}[]> {
			const state = instanceStateMap.get(this);
			return Promise.resolve(ids.map(function(id) {
				return state.data[state.index.get(id)];
			}));
		},

		put(this: Storage<{}, {}>, items: {}[], options?: InMemoryStorageUpdatePragma): Promise<UpdateResults<{}, {}>> {
			const state = instanceStateMap.get(this);
			const ids = this.getIds(items);

			const updatedItems: {}[] = [];
			const oldIndices: number[] = [];
			const newIds: string[] = [];
			const newItems: {}[] = [];

			ids.forEach(function(id, index) {
				const oldIndex = state.index.get(id);
				if (typeof oldIndex === 'undefined') {
					newIds.push(id);
					newItems.push(items[index]);
				}
				else {
					updatedItems.push(items[index]);
					oldIndices.push(oldIndex);
				}
			});
			if (oldIndices.length && options && options.rejectOverwrite) {
				return Promise.reject(Error('Objects already exist in store'));
			}

			updatedItems.forEach(function(item, index) {
				state.data[oldIndices[index]] = item;
			});
			newItems.forEach(function(item, index) {
				state.index.set(newIds[index], state.data.push(item) - 1);
			});

			return Promise.resolve({
				successfulData: items,
				type: StoreOperation.Put
			});
		},

		add(this: Storage<{}, {}>, items: {}[], options?: InMemoryStorageUpdatePragma): Promise<UpdateResults<{}, {}>> {
			options = options || {};
			if (typeof options.rejectOverwrite === 'undefined') {
				options.rejectOverwrite = true;
			}
			return this.put(items, options).then(function(result) {
				result.type = StoreOperation.Add;
				return result;
			});
		},

		delete(this: Storage<{}, {}>, ids: string[]): Promise<UpdateResults<{}, string>> {
			const state = instanceStateMap.get(this);
			const idsToRemove = ids.filter(function(id) {
				return state.index.has(id);
			});

			const indices: number[] = idsToRemove
				.map(function(id) {
					return state.index.get(id);
				})
				.sort();

			idsToRemove.forEach(function(id) {
				state.index.delete(id);
			});
			indices.forEach(function(index, indexArrayIndex) {
				return state.data.splice(index - indexArrayIndex, 1);
			});
			if (indices.length) {
				const firstInvalidIndex = indices[0];
				const updateIndexForIds = this.getIds(state.data.slice(firstInvalidIndex));
				updateIndexForIds.forEach(function(id, index) {
					state.index.set(id, index + firstInvalidIndex);
				});
			}

			return Promise.resolve({
				successfulData: idsToRemove,
				type: StoreOperation.Delete
			});
		},

		patch(this: Storage<{}, {}>, updates: { id: string; patch: Patch<{}, {}> }[], options?: {}): Promise<UpdateResults<{}, {}>> {
			const state = instanceStateMap.get(this);
			let dataPromise: Promise<void>;

			const filteredUpdates = updates.filter(function(update) {
				return state.index.has(update.id);
			});
			const oldIndices = filteredUpdates.map(function(update) {
				return state.index.get(update.id);
			});

			dataPromise = Promise.resolve();
			// If there is a source, the data has already been patched so we only need to sort it
			const updatedItems = filteredUpdates.map(function(update, index) {
				return update.patch.apply(state.data[oldIndices[index]]);
			});

			return Promise.resolve({
				successfulData: updatedItems
			});
		},

		isUpdate(this: Storage<{}, {}>, item: {}): Promise<{ isUpdate: boolean; item: {}; id: string }> {
			const state = instanceStateMap.get(this);
			const id = this.getIds([ item ])[0];
			const isUpdate = state.index.has(id);
			return Promise.resolve({
				id: id,
				item: item,
				isUpdate: isUpdate
			});
		}
	}, <T, O>(instance: Storage<T, O>, options?: InMemoryStorageOptions<T>) => {
	options = options || {};
	const state = <InMemoryStorageState<T>> {};

	state.data = [];
	state.nextId = 1;
	state.index = new Map<string, number>();

	state.idProperty = options.idProperty;
	state.idFunction = options.idFunction;

	instance.getIds = instance.getIds.bind(instance);
	instance.generateId = instance.generateId.bind(instance);
	instance.fetch = instance.fetch.bind(instance);
	instance.get = instance.get.bind(instance);
	instance.put = instance.put.bind(instance);
	instance.add = instance.add.bind(instance);
	instance.delete = instance.delete.bind(instance);
	instance.patch = instance.patch.bind(instance);
	instance.isUpdate = instance.isUpdate.bind(instance);
	instanceStateMap.set(instance, state);
});

export default createInMemoryStorage;
