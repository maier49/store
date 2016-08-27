import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import * as sinon from 'sinon';
import MemoryStore from '../../../src/store/MemoryStore';
import {
	Store, MultiUpdate, ItemsAdded, Update, ItemUpdated, ItemAdded, ItemsUpdated, ItemsDeleted,
	BatchUpdate
} from '../../../src/store/Store';
import { StoreActionResult } from '../../../src/storeActions/StoreAction';
import Patch, { diff } from '../../../src/patch/Patch';
import { createPointer } from '../../../src/patch/JsonPointer';
import { CompoundQuery } from '../../../src/query/Query';
import { createFilter } from '../../../src/query/Filter';
import { createSort } from '../../../src/query/Sort';
import { createRange } from '../../../src/query/StoreRange';
import { duplicate } from 'dojo-core/lang';
import Map from 'dojo-shim/Map';

interface ItemType {
	id: string;
	value: number;
	nestedProperty: { value: number };
}

function createData(): ItemType[] {
	return [
		{
			id: '1',
			value: 1,
			nestedProperty: { value: 3 }
		},
		{
			id: '2',
			value: 2,
			nestedProperty: { value: 2 }
		},
		{
			id: '3',
			value: 3,
			nestedProperty: { value: 1 }
		}
	];
}

function createUpdates(): ItemType[][] {
	return [
		createData().map(function ({ id, value, nestedProperty: { value: nestedValue } }) {
			return {
				id: id,
				value: value + 1,
				nestedProperty: {
					value: nestedValue
				}
			};
		}),
		createData().map(function ({ id, value, nestedProperty: { value: nestedValue } }) {
			return {
				id: id,
				value: value + 1,
				nestedProperty: {
					value: nestedValue + 1
				}
			};
		})
	];
}
const patches: { id: string; patch: Patch<ItemType, ItemType> }[] =
	createData().map(function ({ id, value, nestedProperty: { value: nestedValue } }, index) {
		return {
			id: id,
			patch: diff<ItemType, ItemType>(createData()[index], {
				id: id,
				value: value + 2,
				nestedProperty: {
					value: nestedValue + 2
				}
			})
		};
	}
);

registerSuite({
	name: 'memory store',

	'initialize store'(this: any) {
		const dfd = this.async(1000);
		const data = createData();
		const store: Store<ItemType> = new MemoryStore({
			data: data
		});

		store.fetch().then(dfd.callback(function(fetchedData: ItemType[]) {
			assert.deepEqual(fetchedData, data, 'Fetched data didn\'t match provided data');
		}));
	},

	'basic operations': {
		'add': {
			'should add new items'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const store: Store<ItemType> = new MemoryStore<ItemType>();
				// Add items
				store.add(data[0], data[1]);
				store.add(data[2]);
				let count = 0;
				store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
					count++;
					try {
						assert.deepEqual(update.type, 'add', 'Should emit an add event');
						if (count === 1) {
							assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item),
								[ data[0], data[1] ], 'Should have returned first two items after first update');
						} else {
							assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item),
								[ data[2] ], 'Should have returned last item after second update');
						}
					} catch (e) {
						dfd.reject(e);
					}
					if (count === 2) {
						dfd.resolve();
					}
				});
			},

			'add action with existing items should report conflicts, and allow overwriting with retry'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const updates = createUpdates();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});
				let first = true;
				// Update items with add
				store.add(updates[0][2]).subscribe(function handleResult(result: StoreActionResult<ItemType>) {
					try {
						if (first) {
							assert.isTrue(result.withConflicts, 'Should have had conflicts for existing data');
							assert.isTrue(result.successfulData.updates.length === 0, 'Should not have successful data in the result');
							store.fetch().then(function(currentData: ItemType[]) {
								try {
									assert.deepEqual(currentData, data,
										'Should not have updated existing item after add');
								} catch (e) {
									dfd.reject(e);
								}
							});
							result.retryAll();
							first = false;
						} else {
							assert.isFalse(result.withConflicts, 'Should not have reported any conflicts after retry');
							assert.isTrue(result.successfulData.updates.length === 1);
							assert.deepEqual((<ItemUpdated<ItemType>> result.successfulData.updates[0]).item, updates[0][2], 'Should have updated item after retry');
							store.fetch().then(dfd.callback(function(currentData: ItemType[]) {
								assert.deepEqual(currentData, [ data[0], data[1], updates[0][2] ],
									'Should have updated item after retry');
							}));
						}
					} catch (e) {
						dfd.reject(e);
					}
				});
			}
		},
		'put': {
			'should add new items'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const store: Store<ItemType> = new MemoryStore<ItemType>();
				// Add items with put
				store.put(data[0], data[1]);
				store.put(data[2]);
				let count = 0;
				const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
					count++;
					try {
						assert.deepEqual(update.type, 'update', 'Should emit an update event');
						if (count === 1) {
							assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item),
								[ data[0], data[1] ], 'Should have returned first two items after first update');
						} else {
							assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item),
								[ data[2] ], 'Should have returned last item after second update');
						}
					} catch (e) {
						dfd.reject(e);
					}
					if (count === 2) {
						subscription.unsubscribe();
						dfd.resolve();
					}
				});
			},

			'should update existing items'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const updates = createUpdates();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});
				// Add items with put
				store.put(updates[0][0], updates[0][1]);
				store.put(updates[0][2]);
				let count = -1;
				const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
					count++;
					if (count === 0) {
						// First update will just contain the initial data
						return;
					}
					try {
						assert.deepEqual(update.type, 'update', 'Should emit an update event');
						if (count === 1) {
							assert.deepEqual((<ItemsUpdated<ItemType>> update).updates.map(update => update.item),
								[ updates[0][0], updates[0][1] ], 'Should have returned first two items after first update');
						} else {
							assert.deepEqual((<ItemsUpdated<ItemType>> update).updates.map(update => update.item),
								[ updates[0][2] ], 'Should have returned last item after second update');
						}
					} catch (e) {
						dfd.reject(e);
					}
					if (count === 2) {
						subscription.unsubscribe();
						dfd.resolve();
					}
				});
			},

			'should provide a diff from the old data to the new data'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const updates = createUpdates();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});
				store.put(...updates[0]);

				let ignoreFirst = true;
				store.observe().subscribe(dfd.callback(function(update: MultiUpdate<ItemType>) {
					// Ignore first update which is for adding items
					if (ignoreFirst) {
						ignoreFirst = false;
						return;
					}
					const copy = createData();
					const patches: Patch<ItemType, ItemType>[] =
						(<ItemsUpdated<ItemType>> update).updates.map(update => update.diff());
					copy.forEach((item, index) => patches[index].apply(item));
					assert.deepEqual(copy, (<ItemsUpdated<ItemType>> update).updates.map(update => update.item), 'Didn\'t return correct diffs');
				}));

			}
		},

		'patch': {
			'should allow patching with a single update'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});
				store.patch(patches[0]).subscribe(dfd.callback(function(storeActionResult: StoreActionResult<ItemType>) {
					assert.deepEqual(storeActionResult.successfulData.updates[0].item,
						patches[0].patch.apply(createData()[0]), 'Should have patched item');
				}));
			},

			'should allow patching with an array'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});
				const copy = createData();
				store.patch(patches).subscribe(dfd.callback(function(storeActionResult: StoreActionResult<ItemType>) {
					assert.deepEqual(storeActionResult.successfulData.updates.map(update => update.item),
						patches.map((patchObj, i) => patchObj.patch.apply(copy[i])), 'Should have patched all items');
				}));
			},

			'should allow patching with a Map'(this: any) {
				const dfd = this.async(1000);
				const data = createData();
				const store: Store<ItemType> = new MemoryStore({
					data: data
				});

				const map = new Map<string, Patch<ItemType, ItemType>>();
				patches.forEach(patch => map.set(patch.id, patch.patch));

				const copy = createData();
				store.patch(<Map<string, Patch<ItemType, ItemType>>> map).subscribe(dfd.callback(function(storeActionResult: StoreActionResult<ItemType>) {
					assert.deepEqual(storeActionResult.successfulData.updates.map(update => update.item),
						patches.map((patchObj, i) => patchObj.patch.apply(copy[i])), 'Should have patched all items');
				}));
			}
		}
	},

	'fetch': {
		'should fetch with sort applied'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.fetch(createSort<ItemType>('id', true))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[2], data[1], data[0] ], 'Data fetched with sort was incorrect');
				}));
		},
		'should allow fetch with sort on a sorted store'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.sort(createSort<ItemType>('id', true)).fetch(createSort<ItemType>('id', false))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[0], data[1], data[2] ], 'Data fetched with sort was incorrect');
				}));
		},
		'should fetch with filter applied'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.fetch(createFilter<ItemType>().lessThan('value', 2))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[0] ], 'Data fetched with filter was incorrect');
				}));
		},
		'should allow fetch with filter on a filtered store'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.filter(createFilter<ItemType>().greaterThanOrEqualTo('value', 2)).fetch(createFilter<ItemType>().lessThan('value', 3))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1] ], 'Data fetched with filter was incorrect');
				}));
		},
		'should fetch with range applied'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.fetch(createRange<ItemType>(1, 2))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1], data[2] ], 'Data fetched with range was incorrect');
				}));
		},
		'should allow fetch with range on a range filtered store'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.range(1, 2).fetch(createRange<ItemType>(1, 1))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[2] ], 'Data fetched with range was incorrect');
				}));
		},
		'should fetch with CompoundQuery applied'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			store.fetch(
				new CompoundQuery(
					createFilter()
						.deepEqualTo(createPointer('nestedProperty', 'value'), 2)
						.or()
						.deepEqualTo(createPointer('nestedProperty', 'value'), 3)
				)
					.withQuery(createSort(createPointer('nestedProperty', 'value')))
			)
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1], data[0] ], 'Data fetched with queries was incorrect');
				}));
		}
	},

	'observation': {
		'should be able to observe the store'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			store.observe().subscribe(dfd.callback(function(update: MultiUpdate<ItemType>) {
				assert.strictEqual(update.type, 'add', 'Should have received a notification about updates');
				assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data,
					'Should have received an update for all three items added');
			}));

			store.add(...data);
		},

		'should receive an update when initial items are stored'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore<ItemType>({
				data: data
			});
			store.observe().subscribe(dfd.callback(function(update: MultiUpdate<ItemType>) {
				assert.strictEqual(update.type, 'add', 'Should have received a notification about updates');
				assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data,
					'Should have received an update for all three items added');
			}));
		},

		'should be able to observe a single item'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data.map(item => duplicate(item))
			});
			let updateCount = -1;
			store.observe(data[0].id).subscribe(function(update: Update<ItemType>) {
				try {
					if (updateCount < 0) {
						assert.strictEqual(update.type, 'add');
						assert.deepEqual((<ItemAdded<ItemType>> update).item, data[0], 'Should receive an initial update with the item');
					} else {
						if (updateCount === 3) {
							assert.strictEqual(update.type, 'delete');
						} else if (updateCount === 2) {
							assert.strictEqual(update.type, 'patch');
						} else {
							assert.strictEqual(update.type, 'update');
						}
						if (updateCount === 3) {
							assert.strictEqual(update.id, data[0].id, 'Wrong ID received for delete notification');
						} else if (updateCount ===  2) {
							assert.deepEqual((<ItemUpdated<ItemType>> update).item, {
								id: '1',
								value: 3,
								nestedProperty: {
									value: 5
								}
							}, 'Didn\'t receive update for patch');
						} else {
							assert.deepEqual((<ItemUpdated<ItemType>> update).item, updates[updateCount][0], 'Didn\'t receive updated item');
						}
					}
					updateCount++;
					if (updateCount === 4) {
						dfd.resolve();
					}
				} catch (e) {
					dfd.reject(e);
				}
			});

			store.put(updates[0][0]);
			store.put(updates[1][0]);
			store.patch(patches[0]);
			store.delete(data[0].id);
		},

		'should be able to observe multiple items'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			let addIds: string[] = [];
			let updateIds: string[] = [];
			let deleteIds: string[] = [];
			const containsItemIds = (ids: string[]) => ids.length === 3 &&
				ids.indexOf(data[0].id) > -1 &&
				ids.indexOf(data[1].id) > -1 &&
				ids.indexOf(data[2].id) > -1;
			function checkUpdate(update: ItemAdded<ItemType>, isAdd?: boolean) {
					switch (update.id) {
						case data[0].id:
							assert.deepEqual(
								(<ItemUpdated<ItemType>> update).item,
								isAdd ?  data[0] : updates[0][0],
								'Wrong data returned with update'
							);
							break;
						case data[1].id:
							assert.deepEqual(
								(<ItemUpdated<ItemType>> update).item,
								isAdd ? data[1] : updates[0][1],
								'Wrong data returned with update'
							);
							break;
						case data[2].id:
							assert.deepEqual(
								(<ItemUpdated<ItemType>> update).item,
								isAdd ? data[2] : updates[0][2],
								'Wrong data returned with update'
							);
							break;
					}

			}

			store.observe([ data[0].id, data[1].id, data[2].id ]).subscribe(function(update: Update<ItemType>) {
				try {
					if (update.type === 'add') {
						addIds.push(update.id);
						checkUpdate(<ItemAdded<ItemType>> update, true);
					} else if (update.type === 'update') {
						assert.equal(addIds.length, 3, 'Updates received out of order');
						assert.equal(deleteIds.length, 0, 'Updates received out of order');
						updateIds.push(update.id);
						checkUpdate(<ItemUpdated<ItemType>> update);
					} else {
						assert.equal(updateIds.length, 3, 'Updates received out of order');
						deleteIds.push(update.id);
						if (deleteIds.length === 3) {
							assert.isTrue(
								containsItemIds(addIds) &&
								containsItemIds(updateIds) &&
								containsItemIds(deleteIds), 'Didn\'t receive expected updates'
							);
							dfd.resolve();
						}
					}
				} catch (e) {
					dfd.reject(e);
				}
			});

			store.put(...updates[0]);
			store.delete(data[0].id, data[1].id);
			store.delete(data[2].id);
		},

		'should complete item observations when all relevant items are deleted'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			let observationCount = 0;
			store.observe([ data[0].id, data[1].id, data[2].id ]).subscribe(
				function next() {
					observationCount++;
				},
				function error() {},
				dfd.callback(function completed() {
					assert.equal(observationCount, 10,
						'Should have received updates for adding items, all updates, and all deletions before completion');
				})
			);

			store.put(...updates[0]);
			store.delete(data[0].id, data[1].id);
			store.put(updates[0][2]);
			store.delete(data[2].id);
		},

		'should not allow observing on non-existing ids'(this: any) {
			const dfd = this.async(1000);
			const idNotExist = '4';
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			store.observe(idNotExist).subscribe(function success() {
				dfd.reject(new Error('Should not call success callback.'));
			}, function error() {
				dfd.resolve();
			});
		},

		'should include non-existing ids in the error message'(this: any) {
			const dfd = this.async(1000);
			const idNonExisting = '4';
			const idExisting = '2';
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			store.observe([idExisting, idNonExisting]).subscribe(function success() {},
			dfd.callback(function(error: Error) {
				assert.isTrue(error.message.indexOf(idExisting) === -1, `${idExisting} should not be included in the error message`);
				assert.isTrue(error.message.indexOf(idNonExisting) !== -1, `${idNonExisting} should be included in the error message`);
			}));
		}
	},

	'updates, ordering, and conflicts': {
		'should execute calls in order in which they are called'(this: any) {
			const store: Store<ItemType> = new MemoryStore<ItemType>({});
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			let retrievalCount = 0;

			store.add(data[0]);
			store.get(data[0].id).then(([ item ]) => {
				retrievalCount++;
				try {
					assert.deepEqual(item, data[0], 'Should have received initial item');
				} catch (e) {
					dfd.reject(e);
				}
			});
			store.put(updates[0][0]);
			store.get(data[0].id).then(([ item ]) => {
				retrievalCount++;
				try {
					assert.deepEqual(item, updates[0][0], 'Should have received updated item');
				} catch (e) {
					dfd.reject(e);
				}
			});

			store.put(updates[1][0]);
			store.get(data[0].id).then(([ item ]) => {
				try {
					assert.equal(retrievalCount, 2, 'Didn\'t perform gets in order');
					assert.deepEqual(item, updates[1][0], 'Should have received second updated item');
				} catch (e) {
					dfd.reject(e);
				}
				dfd.resolve();
			});
		},

		'should overwrite dirty data by default'(this: any) {
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			const dfd = this.async(1000);
			store.put(updates[0][0]);
			store.put(updates[1][0]).subscribe(dfd.callback(function(result: StoreActionResult<ItemType>) {
				assert.isFalse(result.withConflicts);
				assert.deepEqual((<ItemUpdated<ItemType>> result.successfulData.updates[0]).item, updates[1][0],
					'Should have taken the second update');
			}));
		},

		'should optionally reject changes to dirty data'(this: any) {
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(updates[0][0]);
				store.put(updates[1][0]).subscribe(function(result: StoreActionResult<ItemType>) {
					try {
						assert.isTrue(result.withConflicts);
					} catch (e) {
						dfd.reject(e);
					}
					result.filter(dfd.callback((item: ItemType, currentItem?: ItemType) => {
						assert.deepEqual(item, updates[1][0], 'Failed update should be passed in filter');
						assert.deepEqual(currentItem, updates[0][0], 'Should provide existing data for filter');
						return true;
					}));
				});
				subscription.unsubscribe();
			});
		}
	},

	're-attempting updates': {
		'should be able to reattempt all failed updates'(this: any) {
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			let firstTry = true;
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(...updates[0]);
				store.put(...updates[1]).subscribe(function(result: StoreActionResult<ItemType>) {
					try {
						if (firstTry) {
							assert.isTrue(result.withConflicts);
							result.retryAll();
							firstTry = false;
						} else {
							assert.isFalse(result.withConflicts);
							assert.equal(result.successfulData.updates.length, 3, 'Should have updated all three items');
							result.successfulData.updates.forEach(function(update: ItemUpdated<ItemType>, index: number) {
								assert.deepEqual(update.item, updates[1][index], 'Result should include updated data');
							});
							dfd.resolve();
						}
					} catch (e) {
						dfd.reject(e);
					}
				});
				subscription.unsubscribe();
			});
		},

		'should be able to selectively reattempt updates'(this: any) {
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			let firstTry = true;
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(...updates[0]);
				store.put(...updates[1]).subscribe(function(result: StoreActionResult<ItemType>) {
					try {
						if (firstTry) {
							assert.isTrue(result.withConflicts);
							let count = 0;
							result.filter((item: ItemType, currentItem?: ItemType) => {
								assert.deepEqual(item, updates[1][count], 'Failed update should be passed in filter');
								assert.deepEqual(currentItem, updates[0][count], 'Should provide existing data for filter');
								count++;
								return count % 2 === 0;
							});
							firstTry = false;
						} else {
							assert.isFalse(result.withConflicts);
							assert.strictEqual(result.successfulData.updates.length, 1, 'Should only have updated one item');
							assert.deepEqual((<ItemUpdated<ItemType>> result.successfulData.updates[0]).item, updates[1][1],
								'Results should reflect updated data');
							dfd.resolve();
						}
					} catch (e) {
						dfd.reject(e);
					}
				});
				subscription.unsubscribe();
			});
		},

		'should complete operation observation when the operation is successfully completed'(this: any) {
			const dfd = this.async(1000);
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore<ItemType>({
				failOnDirtyData: true
			});

			let successCount = 0;
			let errorCount = 0;
			let completedCount = 0;
			store.put(updates[0][0]).subscribe(
				function next(result) {
					try {
						assert.isFalse(result.withConflicts);
					} catch (e) {
						dfd.reject(e);
					}
					successCount++;
				},
				function error() {},
				function completed() {
					completedCount++;
				}
			);

			store.put(...updates[1]).subscribe(
				function next(result) {
					if (result.withConflicts) {
						result.retryAll();
						errorCount++;
					} else {
						successCount++;
					}
				},
				function error() {},
				dfd.callback(function completed() {
					assert.equal(errorCount, 1, 'Multi put should have failed for one dirty item');
					assert.equal(successCount, 2, 'Both updates should have eventually succeesded');
					assert.equal(completedCount, 1, 'Both updates should have completed');
				})
			);
		}
	},

	'transactions': {
		'should allow chaining of operations'(this: any) {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			const data = createData();
			const updates = createUpdates();

			store.transaction()
				.add(...data)
				.put(...updates[0])
				.delete(data[0].id)
				.commit()
				.subscribe(
					function next() {
					},
					function error() {
					},
					function completed() {
						store.fetch().then(dfd.callback(function(data: ItemType[]) {
							assert.deepEqual(data, updates[0].slice(1));
						}));
					}
				);
		},
		'should receive all action results in the transaction in order'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			let count = 0;
			store.transaction()
				.add(...data)
				.put(...updates[0])
				.delete(data[0].id)
				.commit()
				.subscribe(dfd.callback(function(result: StoreActionResult<ItemType>) {
					try {
						if (count === 0) {
							assert.strictEqual(result.successfulData.type, 'add', '1st action should be of type "add"');
							assert.strictEqual(result.successfulData.updates.length, 3);
						} else if (count === 1) {
							assert.strictEqual(result.successfulData.type, 'update', '2nd action should be of type "update"');
							assert.strictEqual(result.successfulData.updates.length, 3);
						} else if (count === 2) {
							assert.strictEqual(result.successfulData.type, 'delete', '3rd action should be of type "delete"');
							assert.strictEqual(result.successfulData.updates.length, 1);
							dfd.resolve();
						}
						count++;
					} catch (e) {
						dfd.reject(e);
					}
				}));
		},
		'should receive all updates made in the transaction in order'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			let count = 0;
			store.observe().subscribe(dfd.callback(function(update: MultiUpdate<ItemType>) {
				try {
					if (count === 0) {
						assert.strictEqual(update.type, 'add', '1st update should be of type "add"');
						assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data);
					} else if (count === 1) {
						assert.strictEqual(update.type, 'update', '2nd update should be of type "update"');
						assert.deepEqual((<ItemsUpdated<ItemType>> update).updates.map(update => update.item), updates[0]);
					} else if (count === 2) {
						assert.strictEqual(update.type, 'delete', '3rd update should be of type "delete"');
						assert.deepEqual((<ItemsDeleted<ItemType>> update).updates.map(update => update.id), data[0].id);
						dfd.resolve();
					}
					count++;
				} catch (e) {
					dfd.reject(e);
				}
			}));

			store.transaction()
				.add(...data)
				.put(...updates[0])
				.delete(data[0].id)
				.commit();
		}
	},

	'subcollections': {
		'should retrieve source collection\'s data with queries'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			store
				.filter(store.createFilter().lessThan('value', 3))
				.sort('value', true)
				.fetch().then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1], data[0] ]);
				}));
		},

		'should delegate to source collection'() {
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			const subCollection = store.filter(store.createFilter().lessThan('value', 3));
			const data = createData();
			const spies = [
				sinon.spy(store, 'put'),
				sinon.spy(store, 'add'),
				sinon.spy(store, 'delete'),
				sinon.spy(store, 'patch')
			];
			subCollection.put(duplicate(data[0]));
			subCollection.add(duplicate(data[0]));
			subCollection.patch(patches[0]);
			subCollection.delete(data[0].id);

			spies.forEach(spy => assert.isTrue(spy.calledOnce));
		},

		'should be notified of changes in parent collection'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const updates = createUpdates();
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			const calls: Array<() => any> = [
				() => store.put(...updates[0].map(item => duplicate(item))),
				() => store.patch(patches),
				() => store.delete(data[0].id)
			];
			const subCollection = store.filter(store.createFilter().lessThan('value', 3));
			store.add(data[0]);
			subCollection.observe().subscribe(function() {
				let nextCall: () => any = calls.shift();
				if (nextCall) {
					nextCall();
				} else {
					dfd.resolve();
				}
			});
		}
	},

	'tracking': {
		'when tracking, subcollection updates should have index information'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const source = new MemoryStore({
				data: [ duplicate(data[0]), duplicate(data[2]) ]
			});
			let deleteReceived = false;
			let addReceived = false;
			let patchReceived = false;
			source
				.sort(createSort<ItemType>('value'))
				.track().then(function(subcollection: Store<ItemType>) {
					subcollection.observe().subscribe(function(update: MultiUpdate<ItemType>) {
						try {
							if (update.type === 'delete') {
								deleteReceived = true;
								assert.equal((<ItemsDeleted<ItemType>> update).updates[0].index, 2,
									'Should have index for deleted item');
							} else if (update.type === 'add') {
								addReceived = true;
								assert.equal((<BatchUpdate<ItemType>> update).updates[0].index, 1,
									'Should have inserted item in correct order');
							} else if (update.type === 'patch') {
								patchReceived = true;
								const itemUpdate = (<ItemsUpdated<ItemType>> update).updates[0];
								assert.equal(itemUpdate.index, 2, 'Should have new index of item');
								assert.equal(itemUpdate.previousIndex, 1, 'Should list previous index of item');
							} else if (update.type === 'update') {
								assert.isTrue(deleteReceived, 'Didn\'t receive delete update');
								assert.isTrue(addReceived, 'Should have received add update');
								assert.isTrue(patchReceived, 'Should have received patch update');
								const itemUpdate = (<ItemsUpdated<ItemType>> update).updates[0];
								assert.equal(itemUpdate.index, 1, 'Should have new index of item');
								dfd.resolve();
							}
						} catch (e) {
							dfd.reject(e);
						}
					});
					source.add(data[1]);
					source.patch(patches[1]);
					source.delete(data[1].id);
					source.put(createData()[1]);
				});
		}
	},

	'release': {
		'release stores should maintain queries and use them when providing update indices'(this: any) {
			const dfd = this.async(1000);
			const data = createData();
			const source = new MemoryStore({
				data: [ duplicate(data[0]), duplicate(data[2]) ]
			});
			let deleteReceived = false;
			let addReceived = false;
			let patchReceived = false;
			source
				.sort(createSort<ItemType>('value'))
				.release().then(function(subcollection: Store<ItemType>) {
					subcollection.observe().subscribe(function(update: MultiUpdate<ItemType>) {
						try {
							if (update.type === 'delete') {
								deleteReceived = true;
								assert.equal((<ItemsDeleted<ItemType>> update).updates[0].index, 2,
									'Should have index for deleted item');
							} else if (update.type === 'add') {
								addReceived = true;
								assert.equal((<BatchUpdate<ItemType>> update).updates[0].index, 1,
									'Should have inserted item in correct order');
							} else if (update.type === 'patch') {
								patchReceived = true;
								const itemUpdate = (<ItemsUpdated<ItemType>> update).updates[0];
								assert.equal(itemUpdate.index, 2, 'Should have new index of item');
								assert.equal(itemUpdate.previousIndex, 1, 'Should list previous index of item');
							} else if (update.type === 'update') {
								assert.isTrue(deleteReceived, 'Didn\'t receive delete update');
								assert.isTrue(addReceived, 'Should have received add update');
								assert.isTrue(patchReceived, 'Should have received patch update');
								const itemUpdate = (<ItemsUpdated<ItemType>> update).updates[0];
								assert.equal(itemUpdate.index, 1, 'Should have new index of item');
								dfd.resolve();
							}
						} catch (e) {
							dfd.reject(e);
						}
					});
					subcollection.add(data[1]);
					subcollection.patch(patches[1]);
					subcollection.delete(data[1].id);
					subcollection.put(createData()[1]);
			});
		}
	}
});
