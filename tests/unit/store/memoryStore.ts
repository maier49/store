import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import * as sinon from 'sinon';
import MemoryStore from '../../../src/store/MemoryStore';
import { Store, MultiUpdate, ItemsAdded, Update, ItemUpdated, ItemAdded } from '../../../src/store/Store';
import { StoreActionResult } from '../../../src/storeActions/StoreAction';
import Patch, { diff } from '../../../src/patch/Patch';
import { createPointer } from '../../../src/patch/JsonPointer';
import { CompoundQuery } from '../../../src/query/Query';
import { createFilter } from '../../../src/query/Filter';
import { createSort } from '../../../src/query/Sort';

interface ItemType {
	id: string;
	value: number;
	nestedProperty: { value: number };
}

const data: ItemType[] = [
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

const updates: ItemType[][] = [
	data.map(function ({ id, value, nestedProperty: { value: nestedValue } }) {
		return {
			id: id,
			value: value + 1,
			nestedProperty: {
				value: nestedValue
			}
		};
	}),
	data.map(function ({ id, value, nestedProperty: { value: nestedValue } }) {
		return {
			id: id,
			value: value + 1,
			nestedProperty: {
				value: nestedValue + 1
			}
		};
	})
];
const patches: { id: string; patch: Patch<ItemType, ItemType> }[] =
	data.map(function ({ id, value, nestedProperty: { value: nestedValue } }, index) {
		return {
			id: id,
			patch: diff<ItemType, ItemType>(data[index], {
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

	'initialize store'() {
		const dfd = this.async(1000);
		const store: Store<ItemType> = new MemoryStore({
			data: data
		});

		store.fetch().then(dfd.callback(function(fetchedData: ItemType[]) {
			assert.deepEqual(fetchedData, data, 'Fetched data didn\'t match provided data');
		}));
	},

	'fetch with queries'() {
		const dfd = this.async(1000);
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
			.then(function(fetchedData: ItemType[]) {
				assert.deepEqual(fetchedData, [data[1], data[0]], 'Data fetched with queries was incorrect');
				dfd.resolve();
			});
	},

	'observation': {
		'should be able to observe the store'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				assert.strictEqual(update.type, 'add', 'Should have received a notification about updates');
				assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data,
					'Should have received an update for all three items added');
				dfd.resolve();
			});

			store.add(...data);
		},

		'should receive an update when initial items are stored'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore<ItemType>({
				data: data
			});
			store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				assert.strictEqual(update.type, 'add', 'Should have received a notification about updates');
				assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data,
					'Should have received an update for all three items added');
				dfd.resolve();
			});
		},

		'should be able to observe a single item'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			let updateCount = -1;
			store.observe(data[0].id).subscribe(function(update: Update<ItemType>) {
				if (updateCount < 0) {
					assert.strictEqual(update.type, 'add');
					assert.deepEqual((<ItemAdded<ItemType>> update).item, data[0], 'Should receive an inital update with the item');
				} else {
					if (updateCount === 3) {
						assert.strictEqual(update.type, 'delete');
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
			});

			store.put(updates[0][0]);
			store.put(updates[1][0]);
			store.patch(patches[0]);
			store.delete(data[0].id);
		},

		'should be able to observe multiple items'() {
			const dfd = this.async(1000);
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
			});

			store.put(...updates[0]);
			store.delete(data[0].id, data[1].id);
			store.delete(data[2].id);
		},

		'should complete item observations when all relevant items are deleted'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});

			let observationCount = 0;
			store.observe([data[0].id, data[1].id, data[2].id]).subscribe(
				function next() {
					observationCount++;
				},
				function error() {},
				function completed() {
					assert.equal(observationCount, 10,
						'Should have received updates for adding items, all updates, and all deletions before completion');
					dfd.resolve();
				}
			);

			store.put(...updates[0]);
			store.delete(data[0].id, data[1].id);
			store.put(updates[0][2]);
			store.delete(data[2].id);
		}
	},

	'updates, ordering, and conflicts': {
		'should execute calls in order in which they are called'() {
			const store: Store<ItemType> = new MemoryStore<ItemType>({});
			const dfd = this.async(1000);
			let retrievalCount = 0;

			store.add(data[0]);
			store.get(data[0].id).then(([ item ]) => {
				retrievalCount++;
				assert.deepEqual(item, data[0], 'Should have received initial item');
			});
			store.put(updates[0][0]);
			store.get(data[0].id).then(([ item ]) => {
				retrievalCount++;
				assert.deepEqual(item, updates[0][0], 'Should have received updated item');
			});

			store.put(updates[1][0]);
			store.get(data[0].id).then(([ item ]) => {
				assert.equal(retrievalCount, 2, 'Didn\'t perform gets in order');
				assert.deepEqual(item, updates[1][0], 'Should have received second updated item');
				dfd.resolve();
			});
		},

		'should overwrite dirty data by default'() {
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			store.put(updates[0][0]);
			store.put(updates[1][0]).subscribe(function(result: StoreActionResult<ItemType>) {
				assert.isFalse(result.withErrors);
				assert.deepEqual((<ItemUpdated<ItemType>> result.successfulData.updates[0]).item, updates[1][0],
					'Should have taken the second update');
			});
		},

		'should optionally reject changes to dirty data'() {
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(updates[0][0]);
				store.put(updates[1][0]).subscribe(function(result: StoreActionResult<ItemType>) {
					assert.isTrue(result.withErrors);
					result.filter((item: ItemType, currentItem?: ItemType) => {
						assert.deepEqual(item, updates[1][0], 'Failed update should be passed in filter');
						assert.deepEqual(currentItem, updates[0][0], 'Should provide existing data for filter');
						dfd.resolve();
						return true;
					});
				});
				subscription.unsubscribe();
			});
		}
	},

	're-attempting updates': {
		'should be able to reattempt all failed updates'() {
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			let firstTry = true;
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(...updates[0]);
				store.put(...updates[1]).subscribe(function(result: StoreActionResult<ItemType>) {
					if (firstTry) {
						assert.isTrue(result.withErrors);
						result.retryAll();
						firstTry = false;
					} else {
						assert.isFalse(result.withErrors);
						assert.equal(result.successfulData.updates.length, 3, 'Should have updated all three items');
						result.successfulData.updates.forEach(function(update: ItemUpdated<ItemType>, index: number) {
							assert.deepEqual(update.item, updates[1][index], 'Result should include updated data');
						});
						dfd.resolve();
					}
				});
				subscription.unsubscribe();
			});
		},

		'should be able to selectively reattempt updates'() {
			const store: Store<ItemType> = new MemoryStore({
				data: data,
				failOnDirtyData: true
			});
			let firstTry = true;
			const dfd = this.async(1000);
			const subscription = store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				store.put(...updates[0]);
				store.put(...updates[1]).subscribe(function(result: StoreActionResult<ItemType>) {
					if (firstTry) {
						assert.isTrue(result.withErrors);
						let count = 0;
						result.filter((item: ItemType, currentItem?: ItemType) => {
							assert.deepEqual(item, updates[1][count], 'Failed update should be passed in filter');
							assert.deepEqual(currentItem, updates[0][count], 'Should provide existing data for filter');
							count++;
							return count % 2 === 0;
						});
						firstTry = false;
					} else {
						assert.isFalse(result.withErrors);
						assert.strictEqual(result.successfulData.updates.length, 1, 'Should only have updated one item');
						assert.deepEqual((<ItemUpdated<ItemType>> result.successfulData.updates[0]).item, updates[1][1],
							'Results should reflect updated data');
						dfd.resolve();
					}
				});
				subscription.unsubscribe();
			});
		},

		'should complete operation observation when the operation is successfully completed'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore<ItemType>({
				failOnDirtyData: true
			});

			let successCount = 0;
			let errorCount = 0;
			let completedCount = 0;
			store.put(updates[0][0]).subscribe(
				function next(result) {
					assert.isFalse(result.withErrors);
					successCount++;
				},
				function error() {},
				function completed() {
					completedCount++;
				}
			);

			store.put(...updates[1]).subscribe(
				function next(result) {
					if (result.withErrors) {
						result.retryAll();
						errorCount++;
					} else {
						successCount++;
					}
				},
				function error() {},
				function completed() {
					assert.equal(errorCount, 1, 'Multi put should have failed for one dirty item');
					assert.equal(successCount, 2, 'Both updates should have eventually succeesded');
					assert.equal(completedCount, 1, 'Both updates should have completed');
					dfd.resolve();
				}
			);
		}
	},

	'transactions': {
		'should allow chaining of operations'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore<ItemType>();

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
						store.fetch().then(function(data) {
							assert.deepEqual(data, updates[0].slice(1));
							dfd.resolve();
						});
					}
				);
		}
	},

	'subcollections': {
		'should retrieve source collection\'s data with queries'() {
			const dfd = this.async(1000);
			const store: Store<ItemType> = new MemoryStore({
				data: data
			});
			store
				.filter(store.createFilter().lessThan('value', 3))
				.sort('value', true)
				.fetch().then(function(fetchedData) {
					assert.deepEqual(fetchedData, [data[1], data[0]]);
					dfd.resolve();
				});
		},

		'should delegate to source collection'() {
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			const subCollection = store.filter(store.createFilter().lessThan('value', 3));
			const spies = [
				sinon.spy(store, 'put'),
				sinon.spy(store, 'add'),
				sinon.spy(store, 'delete'),
				sinon.spy(store, 'patch')
			];
			subCollection.put(data[0]);
			subCollection.add(data[0]);
			subCollection.delete(data[0].id);
			subCollection.patch(patches[0]);

			spies.forEach(spy => assert.isTrue(spy.calledOnce));
		},

		'TODO - should be notified of changes in parent collection'() {
			// const dfd = this.async(1000);
			// const store: Store<ItemType> = new MemoryStore<ItemType>();
			// const subCollection = store.filter(store.createFilter().lessThan('value', 3));
		}
	}
});
