import createStore, { StoreOptions, CrudOptions, Store, PatchArgument } from './createStore';
import { UpdateResults } from '../storage/createInMemoryStorage';
import { ComposeFactory } from 'dojo-compose/compose';
import WeakMap from 'dojo-shim/WeakMap';
import { StoreObservable } from './createStoreObservable';
import { Query } from '../query/createQuery';

export interface SubcollectionOptions<T, O extends CrudOptions, U extends UpdateResults<T>> extends StoreOptions<T, O> {
	source?: Store<T, O, U>;
}

interface SubcollectionState<T, O extends CrudOptions, U extends UpdateResults<T>> {
	source?: Store<T, O, U>;
	factory: Function;
}

const instanceStateMap = new WeakMap<SubcollectionStore<{}, {}, any, any>, SubcollectionState<{}, {}, any>>();

/**
 * This type is primarily intended for consumption by other mixins that require knowledge of a store's
 * source, e.g. querying/tracking.
 */
export interface SubcollectionStore<T, O extends CrudOptions, U extends UpdateResults<T>, C extends Store<T, O, U>> extends Store<T, O, U> {
	createSubcollection(): C & SubcollectionStore<T, O, U, C>;
	readonly source: C | undefined;
	readonly factory: (options: O) => (C & SubcollectionStore<T, O, U, C>) | undefined;
	getOptions(): SubcollectionOptions<T, O, U>;
}

export interface SubcollectionFactory extends ComposeFactory<SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, SubcollectionOptions<{}, {}, any>> {
	<T extends {}, O extends CrudOptions>(options?: SubcollectionOptions<T, O, UpdateResults<T>>): SubcollectionStore<T, O, UpdateResults<T>, SubcollectionStore<T, O, UpdateResults<T>, any>>;
}

const createSubcollectionStore: SubcollectionFactory = createStore
	.extend({
		get source(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>) {
			const state = instanceStateMap.get(this);
			return state && state.source;
		},

		get factory(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>) {
			const state = instanceStateMap.get(this);
			return state && state.factory;
		},

		createSubcollection(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>) {
			// Need to reassign the factory or compose throws an error for instantiating
			// with new
			const factory = this.factory;
			return factory(this.getOptions());
		},

		getOptions(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>): SubcollectionOptions<{}, {}, any> {
			return {
				source: this,
				// Provide something to prevent the Subcollection from instantiating its own storage. The type doesn't
				// matter because it'll never be used.
				storage: <any> true
			};
		}
	}).mixin({
		initialize<T, O extends CrudOptions, U extends UpdateResults<T>>(
			instance: SubcollectionStore<T, O, U, SubcollectionStore<T, O, U, any>>,
			options?: SubcollectionOptions<T, O, U>) {
			options = options || {};
			instanceStateMap.set(instance, {
				source: options.source,
				factory: instance.constructor
			});
		},
		aspectAdvice: {
			around: {
				get(get: (ids: string | string[]) => Promise<{}[]>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, ids: string | string[]) {
						if (this.source) {
							return this.source.get(ids);
						} else {
							return get.call(this, ids);
						}
					};
				},

				add(add: (items: {} | {}[], options?: CrudOptions) => StoreObservable<{}, any>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, items: {} | {}[], options?: CrudOptions) {
						if (this.source) {
							return this.source.add(items, options);
						} else {
							return add.call(this, items, options);
						}
					};
				},

				delete(_delete: (ids: string | string[]) => Promise<string[]>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, ids: string | string[]) {
						if (this.source) {
							return this.source.delete(ids);
						}	 else {
							return _delete.call(this, ids);
						}
					};
				},

				put(put: (items: {} | {}[], options?: CrudOptions) => StoreObservable<{}, any>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, items: {} | {}[], options?: CrudOptions) {
						if (this.source) {
							return this.source.put(items, options);
						} else {
							return put.call(this, items, options);
						}
					};
				},

				patch(patch: (updates: PatchArgument<{}>, options?: CrudOptions) => StoreObservable<{}, any>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, updates: PatchArgument<{}>, options?: CrudOptions) {
						if (this.source) {
							return this.source.patch(updates, options);
						} else {
							return patch.call(this, updates, options);
						}
					};
				},

				fetch(fetch: (query?: Query<{}, {}>) => Promise<{}[]>) {
					return function(this: SubcollectionStore<{}, {}, any, SubcollectionStore<{}, {}, any, any>>, query?: Query<{}, {}>) {
						if (this.source) {
							return this.source.fetch(query);
						} else {
							return fetch.call(this, query);
						}
					};
				}
			}
		}
	});

export default createSubcollectionStore;
