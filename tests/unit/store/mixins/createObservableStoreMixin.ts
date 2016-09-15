import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';

import createObservableStoreMixin, {
	ObservableStore, ObservableStoreOptions, StoreDelta,
	ItemUpdate
} from '../../../../src/store/mixins/createObservableStoreMixin';
import { ItemType, createData, createUpdates, patches } from '../../support/createData';
import createStore, { CrudOptions } from '../../../../src/store/createStore';
import { UpdateResults } from '../../../../src/storage/createInMemoryStorage';
import { ComposeFactory } from 'dojo-compose/compose';
import { SubcollectionStore, SubcollectionOptions } from '../../../../src/store/createSubcollectionStore';

interface ObservableStoreFactory extends ComposeFactory<ObservableStore<{}, {}, any>, ObservableStoreOptions<{}, {}>> {
	<T, O extends CrudOptions, U extends UpdateResults<T>>(options?: ObservableStoreOptions<T, O>): ObservableStore<T, O, U>;
}

type SubcollectionObservableStore<T, O extends CrudOptions, U extends UpdateResults<T>> = ObservableStore<T, O, U> & SubcollectionStore<T, O, U, ObservableStore<T, O, U>>;
interface ObservableSubcollectionStoreFactory extends ComposeFactory<SubcollectionStore<{}, {}, any, ObservableStore<{}, {}, any>>, SubcollectionOptions<{}, {}, any> & ObservableStoreOptions<{}, {}>> {
	<T, O extends CrudOptions, U extends UpdateResults<T>>(options?: SubcollectionOptions<T, O, U> & ObservableStoreOptions<T, O>): SubcollectionStore<T, O, U, ObservableStore<T, O, U>>;
}

registerSuite({
	name: 'observableStoreMixin',

	'with basic store': (function() {
		const createObservableStore: ObservableStoreFactory = createStore
			.mixin(createObservableStoreMixin());
		let observableStore: ObservableStore<ItemType, CrudOptions, UpdateResults<ItemType>>;
		const ids = createData().map(function(item) {
			return item.id;
		});
		return {
			beforeEach: function() {
				observableStore = createObservableStore({
					data: createData()
				});
			},

			'can observe whole store': {
				put(this: any) {
					const dfd = this.async(1000);
					const updates = createUpdates();
					observableStore.observe().subscribe(dfd.callback(function(update: StoreDelta<ItemType>) {
						assert.deepEqual(update, {
							updates: [ updates[0][0] ],
							deletes: [],
							beforeAll: undefined,
							afterAll: undefined,
							adds: []
						}, 'Didn\'t send the proper update');
					}));
					observableStore.put(updates[0][0]);
				},

				patch(this: any) {
					const dfd = this.async(1000);
					observableStore.observe().subscribe(dfd.callback(function(update: StoreDelta<ItemType>) {
						// Patch operate on the item itself in a memory store. This means that any references
						// to that item will be updated immediately
						assert.deepEqual(update, {
							updates: [ patches[0].patch.apply(createData()[0]) ],
							deletes: [],
							beforeAll: undefined,
							afterAll: undefined,
							adds: []
						}, 'Didn\'t send the proper update');
					}));
					observableStore.patch(patches[0]);
				},

				add(this: any) {
					const dfd = this.async(1000);
					const data = createData();
					observableStore = createObservableStore<ItemType, CrudOptions, UpdateResults<ItemType>>();
					observableStore.observe().subscribe(dfd.callback(function(update: StoreDelta<ItemType>) {
						assert.deepEqual(update, {
							updates: [],
							deletes: [],
							beforeAll: undefined,
							afterAll: undefined,
							adds: [ data[0] ]
						});
					}));
					observableStore.add(data[0]);
				},

				delete(this: any) {
					const dfd = this.async(1000);
					observableStore.observe().subscribe(dfd.callback(function(update: StoreDelta<ItemType>) {
						assert.deepEqual(update, {
							updates: [],
							deletes: [ ids[0] ],
							beforeAll: undefined,
							afterAll: undefined,
							adds: []
						});
					}));
					observableStore.delete(ids[0]);
				}
			},

			'can observe items by ids': {
				'observing a single id': {
					put(this: any) {
						const dfd = this.async(1000);
						const updatedItem = createUpdates()[0][0];
						let firstUpdate = true;
						observableStore.observe(ids[0]).subscribe(function(update: ItemType) {
							try {
								if (firstUpdate) {
									firstUpdate = false;
									assert.deepEqual(update, createData()[0], 'Didn\'t send the initial notification for item');
								} else {
									assert.deepEqual(update, updatedItem, 'Didn\'t send the correct update');
									dfd.resolve();
								}
							} catch (error) {
								dfd.reject(error);
							}
						});
						observableStore.put(updatedItem);
					},

					patch(this: any) {
						const dfd = this.async(1000);
						const patch = patches[0];
						let firstUpdate = true;
						observableStore.observe(ids[0]).subscribe(function(update: ItemType) {
							assert.deepEqual(update, patch.patch.apply(createData()[0]), 'Didn\'t send the correct update');
							if (firstUpdate) {
								firstUpdate = false;
							}
							else {
								dfd.resolve();
							}
						});
						observableStore.patch(patch);
					},

					delete(this: any) {
						const dfd = this.async(1000);
						let updatePassed = false;
						let firstUpdate = true;
						observableStore.observe(ids[0]).subscribe(function(update: ItemType) {
							try {
								if (firstUpdate) {
									firstUpdate = false;
									assert.deepEqual(update, createData()[0], 'Didn\'t send the initial notification for item');
									updatePassed = true;
								}
								else {
									throw Error('Shouldn\'t have sent another update before completing');
								}
							} catch (error) {
								dfd.reject(error);
							}
						}, null, dfd.callback(function() {
							assert.isTrue(updatePassed, 'Should have updated before completing');
						}));
						observableStore.delete(ids[0]);
					}
				},
				'observing multiple ids': function(this: any) {
					const dfd = this.async(1000);
					const data = createData();

					let initialUpdate = 0;

					let putUpdate = false;
					const put = createUpdates()[0][0];

					let patchUpdate = false;
					const patched = patches[1].patch.apply(createData()[1]);
					const patch = patches[1];

					let firstDelete = false;
					let secondDelete = false;
					let thirdDelete = false;
					observableStore.observe(ids).subscribe(function(update: ItemUpdate<ItemType>) {
						try {
							if (initialUpdate < 3) {
								if (initialUpdate !== 1) {
									assert.deepEqual(update, {
											item: data[initialUpdate],
											id: data[initialUpdate].id
										}, 'Didn\'t send proper initial update'
									);
								}
								else {
									// Special case for patched item
									assert.deepEqual(update, {
											item: patched,
											id: patched.id
										}, 'Didn\'t send proper update for patched data'
									);
								}
								initialUpdate++;
								return;
							}
							if (!putUpdate) {
								assert.deepEqual(update, {
										item: put,
										id: put.id
									}, 'Didn\'t send the right update for put operation'
								);
								putUpdate = true;
							}
							else if (!patchUpdate) {
								assert.deepEqual(update, {
										item: patched,
										id: patched.id
									}, 'Didn\'t send the right update for patch operation'
								);
								patchUpdate = true;
							}
							else if (!firstDelete) {
								assert.deepEqual(update, {
										item: null,
										id: data[0].id
									}, 'Didn\'t send the right update for first delete operation'
								);
								firstDelete = true;
							}
							else if (!secondDelete) {
								assert.deepEqual(update, {
										item: null,
										id: data[1].id
									}, 'Didn\'t send the right update for second delete operation'
								);
								secondDelete = true;
							}
							else if (!thirdDelete) {
								assert.deepEqual(update, {
										item: null,
										id: data[2].id
									}, 'Didn\'t send the right update for third delete operation'
								);
								thirdDelete = true;
							}
							else {
								throw Error('Shouldn\'t have received another update');
							}

						} catch (error) {
							dfd.reject(error);
						}
					}, null, dfd.callback(function() {
						assert.isTrue(
							putUpdate && patchUpdate && firstDelete && secondDelete && thirdDelete,
							'Didn\'t send all updates before completing observable'
						);
					}));
					observableStore.put(put);
					observableStore.patch(patch);
					observableStore.delete([ ids[0], ids[1] ]);
					observableStore.delete(ids[2]);
				}
			}
		};
	})()
});
