import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import createStore, { StoreOperation } from '../../../src/store/createStore';
import Patch from '../../../src/patch/Patch';
import Map from 'dojo-shim/Map';
import { createRange } from '../../../src/query/StoreRange';
import { createFilter } from '../../../src/query/Filter';
import { createPointer } from '../../../src/patch/JsonPointer';
import { createSort } from '../../../src/query/Sort';
import createCompoundQuery from '../../../src/query/createQuery';
import { createData, ItemType, createUpdates, patches } from '../support/createData';

function getStoreAndDfd(test: any, data = createData()) {
	const dfd = test.async(1000);
	const store = createStore( { data: data } );
	const emptyStore = createStore();

	return { dfd, store, emptyStore, data: createData() };
}

const ids = createData().map(function(item) {
	return item.id;
});

registerSuite({
	name: 'createStore',

	'initialize store'(this: any) {
		const { dfd, store, data } = getStoreAndDfd(this);

		store.fetch().then(dfd.callback(function(fetchedData: ItemType[]) {
			assert.deepEqual(fetchedData, data, 'Fetched data didn\'t match provided data');
		}));
	},

	'basic operations': {
		'add': {
			'should add new items'(this: any) {
				const { dfd, emptyStore: store, data } = getStoreAndDfd(this);
				// Add items
				store.add([ data[0], data[1] ]);
				store.add(data[2]);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData, data, 'Didn\'t add items');
				}).then(dfd.resolve);
			},

			'add action with existing items should fail'(this: any) {
				const { dfd, store } = getStoreAndDfd(this);
				const updates = createUpdates();

				store.add(updates[0][2]).then().catch(function (error: any) {
					assert.equal(error.message, 'Objects already exist in store',
						'Didn\'t reject with appropriate error message');
				}).then(dfd.resolve);
			},

			'add action with rejectOverwrite: false in options should overwrite existing data': function(this: any) {
				const { dfd, store } = getStoreAndDfd(this);
				const updates = createUpdates();
				// Update items with add
				store.add(updates[0][2], { rejectOverwrite: false }).then(function(items) {
					assert.deepEqual(items, [ updates[0][2] ], 'Didn\'t successfully return item');
				}).then(dfd.resolve);
			}
		},
		'put': {
			'should add new items'(this: any) {
				const { dfd, data, emptyStore: store } = getStoreAndDfd(this);
				// Add items with put
				store.put([ data[0], data[1] ]);
				store.put(data[2]);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData, data, 'Didn\'t add items');
				}).then(dfd.resolve);
			},

			'should update existing items'(this: any) {
				const { dfd, store } = getStoreAndDfd(this);
				const updates = createUpdates();
				// Add items with put
				store.put([ updates[0][0], updates[0][1] ]);
				store.put(updates[0][2]);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData, updates[0], 'Didn\'t update items');
				}).then(dfd.resolve);
			}
		},

		'patch': {
			'should allow patching with a single update'(this: any) {
				const { dfd, store } = getStoreAndDfd(this);
				store.patch(patches[0]);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData[0], patches[0].patch.apply(createData()[0]),
						'Should have patched item');
				}).then(dfd.resolve);
			},

			'should allow patching with an array'(this: any) {
				const { dfd, store, data: copy } = getStoreAndDfd(this);
				store.patch(patches);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData, patches.map((patchObj, i) => patchObj.patch.apply(copy[i])),
						'Should have patched all items');
				}).then(dfd.resolve);
			},

			'should allow patching with a Map'(this: any) {
				const { dfd, store, data: copy } = getStoreAndDfd(this);

				const map = new Map<string, Patch<ItemType, ItemType>>();
				patches.forEach(patch => map.set(patch.id, patch.patch));

				store.patch(map);
				store.fetch().then(function(storeData) {
					assert.deepEqual(storeData, patches.map((patchObj, i) => patchObj.patch.apply(copy[i])),
						'Should have patched all items');
				}).then(dfd.resolve);
			}
		}
	},

	'fetch': {
		'should fetch with sort applied'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);

			store.fetch(createSort<ItemType>('id', true))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[2], data[1], data[0] ], 'Data fetched with sort was incorrect');
				}));
		},

		'should fetch with filter applied'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);

			store.fetch(createFilter<ItemType>().lessThan('value', 2))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[0] ], 'Data fetched with filter was incorrect');
				}));
		},

		'should fetch with range applied'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);

			store.fetch(createRange<ItemType>(1, 2))
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1], data[2] ], 'Data fetched with range was incorrect');
				}));
		},

		'should fetch with CompoundQuery applied'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);

			store.fetch(
				createCompoundQuery({
					query:
						createFilter()
							.deepEqualTo(createPointer('nestedProperty', 'value'), 2)
							.or()
							.deepEqualTo(createPointer('nestedProperty', 'value'), 3)
				}).withQuery(createSort(createPointer('nestedProperty', 'value')))
			)
				.then(dfd.callback(function(fetchedData: ItemType[]) {
					assert.deepEqual(fetchedData, [ data[1], data[0] ], 'Data fetched with queries was incorrect');
				}));
		}
	},

	'crud operations should return an observable': function(this: any) {
		const data = createData();
		const { dfd, store } = getStoreAndDfd(this, [data[0]]);

		store.add(data[1]).subscribe(function(updateResults) {
			assert.equal(updateResults.type, StoreOperation.Add, 'Update results had wrong type');
			assert.deepEqual(updateResults.successfulData, [ data[1] ], 'Update results had wrong item');

			store.put(data[2]).subscribe(function(updateResults) {
				assert.equal(updateResults.type, StoreOperation.Put, 'Update results had wrong type');
				assert.deepEqual(updateResults.successfulData, [ data[2] ], 'Update results had wrong item');

				store.patch(patches[0]).subscribe(function(updateResults) {
					assert.equal(updateResults.type, StoreOperation.Patch, 'Update results had wrong type');
					assert.deepEqual(updateResults.successfulData, [ data[0] ], 'Update results had wrong item');

					store.delete(data[0].id).subscribe(function(updateResults) {
						assert.equal(updateResults.type, StoreOperation.Delete, 'Update results had wrong type');
						assert.deepEqual(updateResults.successfulData, [ data[0].id ], 'Update results had wrong id');
					}, dfd.reject, dfd.resolve);
				});
			});
		});
	},

	'should allow a property or function to be specified as the id': function(this: any) {
		const data = createData();
		const updates = createUpdates();
		const store = createStore({
			data: updates[0],
			idProperty: 'value'
		});
		const idFunctionStore = createStore({
			idFunction: (item: ItemType) => item.id + '-id',
			data: data
		});

		assert.deepEqual(store.identify(updates[0]), [2, 3, 4], 'Should have used value property as the id');
		assert.deepEqual(idFunctionStore.identify(data), ['1-id', '2-id', '3-id'], 'Should have used id function to create item ids');
	},

	'should execute calls in order in which they are called'(this: any) {
		const { dfd, data, emptyStore: store } = getStoreAndDfd(this);
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

	'should generate unique ids': function(this: any) {
		const ids: Promise<string>[] = [];
		const store =  createStore();
		const generateNIds = 100000;
		for (let i = 0; i < generateNIds; i++) {
			ids.push(store.createId());
		}
		Promise.all(ids).then(function(ids) {
			assert.equal(new Set(ids).size, generateNIds, 'Not all generated IDs were unique');
		});
	},
	'should be able to get all updates by treating as a promise': {
		add(this: any) {
			const { dfd, emptyStore: store, data } = getStoreAndDfd(this);
			store.add(data).then(function(result) {
				assert.deepEqual(result, data, 'Should have returned all added items');
			}).then(dfd.resolve);

		},
		'add with conflicts should fail': function(this: any) {
			const { dfd,  data } = getStoreAndDfd(this);
			const store = createStore({
				data: [ data[0], data[1] ]
			});
			store.add(data).then(dfd.reject, dfd.resolve);
		},

		put(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);
			store.put(data).then(function(result) {
				assert.deepEqual(result, data, 'Should have returned all updated items');
			}).then(dfd.resolve);
		},
		'put with conflicts should override': function(this: any) {
			const { dfd,  data } = getStoreAndDfd(this);
			const store = createStore({
				data: [ data[0], data[1] ]
			});
			store.put(data).then(function(result) {
				assert.deepEqual(result, data, 'Should have returned all updated items');
			}).then(dfd.resolve);
		},

		patch(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);
			const expectedResult = data.map(function(item) {
				item.value += 2;
				item.nestedProperty.value += 2;
				return item;
			});
			store.patch(patches).then(function(result) {
				assert.deepEqual(result, expectedResult, 'Should have returned all patched items');
			}).then(dfd.resolve);
		},
		delete(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);
			store.delete(ids).then(function(result) {
				assert.deepEqual(result, ids, 'Should have returned all deleted ids');
			}).then(dfd.resolve);
		}
	}
});
