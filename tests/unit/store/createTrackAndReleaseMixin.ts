import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import { CrudOptions, StoreOperation } from '../../../src/store/createStore';
import createSubcollectionStore, { SubcollectionOptions } from '../../../src/store/createSubcollectionStore';
import createObservableStoreMixin, { ObservableStore, ObservableStoreOptions } from '../../../src/store/mixins/createObservableStoreMixin';
import createQueryMixin, { QueryStore } from '../../../src/store/mixins/createQueryMixin';
import createTrackAndReleaseMixin, { TrackAndReleaseStore, TrackAndReleaseOptions, TrackedStoreDelta } from '../../../src/store/mixins/createTrackAndReleaseMixin';
import { UpdateResults } from '../../../src/storage/createInMemoryStorage';
import { ComposeFactory } from 'dojo-compose/compose';
import { createSort } from '../../../src/query/Sort';
import { createData, ItemType, patches } from '../support/createData';

type TrackedObservableQueryStore<T, O extends CrudOptions, U extends UpdateResults<T>> =
	TrackAndReleaseStore<T, O, U, ObservableStore<T, O, U>> &
	ObservableStore<T, O, U> &
	QueryStore<T, O, U, ObservableStore<T, O, U>>;

interface TrackedObservableQueryFactory extends ComposeFactory<any, any> {
		<T, O extends CrudOptions, U extends UpdateResults<T>>(options?: TrackAndReleaseOptions<T> &
															SubcollectionOptions<T, O, U> &
															ObservableStoreOptions<T, O>): TrackedObservableQueryStore<T, O, U>;
}

const createTrackAndReleaseStore: TrackedObservableQueryFactory = createSubcollectionStore
	.mixin(createQueryMixin())
	.mixin(createObservableStoreMixin())
	.mixin(createTrackAndReleaseMixin());

function getStoreAndDfd(test: any, data = createData()) {
	const dfd = test.async(1000);
	const store = createTrackAndReleaseStore( { data: data } );

	return { dfd, store, data: createData() };
}

registerSuite({
	name: 'createTrackAndReleaseMixin',
	'tracking': {
		'when tracking, subcollection updates should have index information'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);

			const subcollection = store
				.sort(createSort<ItemType>('value'))
				.track();
			let deleteReceived = false;
			let addReceived = false;
			let patchReceived = false;
			subcollection.observe().subscribe(function(update: TrackedStoreDelta<ItemType>) {
				try {
					if (update.type === StoreOperation.Delete) {
						deleteReceived = true;
						assert.equal(update.removedFromTracked[0].index, 2,
							'Should have index for deleted item');
					} else if (update.type === StoreOperation.Add) {
						addReceived = true;
						assert.equal(update.addedToTracked[0].index, 1,
							'Should have inserted item in correct order');
					} else if (update.type === StoreOperation.Patch) {
						patchReceived = true;
						// TODO
					} else if (update.type === StoreOperation.Put) {
						assert.isTrue(deleteReceived, 'Didn\'t receive delete update');
						assert.isTrue(addReceived, 'Should have received add update');
						assert.isTrue(patchReceived, 'Should have received patch update');
						const itemUpdate = update.movedInTracked[0];
						assert.equal(itemUpdate.index, 1, 'Should have new index of item');
						dfd.resolve();
					}
				} catch (e) {
					dfd.reject(e);
				}
			});
			store.add(data[1]);
			store.patch(patches[1]);
			store.delete(data[1].id);
			store.put(createData()[1]);
		}
	},

	'release': {
		'release stores should maintain queries and use them when providing update indices'(this: any) {
			const { dfd, store, data } = getStoreAndDfd(this);
			store.sort(createSort<ItemType>('value'))
				.release();
			let deleteReceived = false;
			let addReceived = false;
			let patchReceived = false;
			store.observe().subscribe(function(update: TrackedStoreDelta<ItemType>) {
				try {
					if (update.type === StoreOperation.Delete) {
						deleteReceived = true;
						assert.equal(update.removedFromTracked[0], 2,
							'Should have index for deleted item');
					} else if (update.type === StoreOperation.Add) {
						addReceived = true;
						assert.equal(update.addedToTracked[0].index, 1,
							'Should have inserted item in correct order');
					} else if (update.type === StoreOperation.Patch) {
						// TODO
					} else if (update.type === StoreOperation.Put) {
						assert.isTrue(deleteReceived, 'Didn\'t receive delete update');
						assert.isTrue(addReceived, 'Should have received add update');
						assert.isTrue(patchReceived, 'Should have received patch update');
						const itemUpdate = update.movedInTracked[0];
						assert.equal(itemUpdate.index, 1, 'Should have new index of item');
						dfd.resolve();
					}
				} catch (e) {
					dfd.reject(e);
				}
			});
			store.add(data[1]);
			store.patch(patches[1]);
			store.delete(data[1].id);
			store.put(createData()[1]);
		}
	}
});
