import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import { StoreOptions, CrudOptions } from '../../../../src/store/createStore';
import { UpdateResults } from '../../../../src/storage/createInMemoryStorage';
import createTrackableMixin, { TrackableOptions, TrackableMixin } from '../../../../src/store/mixins/createTrackableMixin';
import createQueryMixin, { QueryMixin, QueryOptions } from '../../../../src/store/mixins/createQueryMixin';
import { ComposeFactory } from 'dojo-compose/compose';
import createSubcollectionStore from '../../../../src/store/createSubcollectionStore';
import createObservableStoreMixin from '../../../../src/store/mixins/createObservableStoreMixin';
import { ItemType, createData } from '../../support/createData';
import { ObservableStore } from '../../../../src/store/mixins/createObservableStoreMixin';
import { SubcollectionStore } from '../../../../src/store/createSubcollectionStore';
import {ObservableStoreOptions} from '../../../../src/store/mixins/createObservableStoreMixin';
import createOrderedOperationMixin from '../../../../src/store/mixins/createOrderedOperationMixin';
import { StoreObservable } from '../../../../src/store/createStoreObservable';

interface TrackableObservableQueryStore<T, O extends CrudOptions, U extends UpdateResults<T>> extends
	ObservableStore<T, O, U>,
	SubcollectionStore<T, O, U, ObservableStore<T, O, U>>,
	QueryMixin<T, O, U, ObservableStore<T, O, U>>,
	TrackableMixin<T, O, U, ObservableStore<T, O, U>> {
}

type TrackableQueryOptions<T, O extends CrudOptions> =
	TrackableOptions<T> & StoreOptions<T, CrudOptions> & QueryOptions<T> & ObservableStoreOptions<T, O>;

interface TrackableQueryStoreFactory extends ComposeFactory<TrackableObservableQueryStore<{}, {}, any>, TrackableQueryOptions<{}, {}>> {
	<T, O extends CrudOptions, U extends UpdateResults<T>>(options?: TrackableQueryOptions<T, O>): TrackableObservableQueryStore<T, O, U>;
}

registerSuite(function() {
	let createTrackbleQueryStore = createSubcollectionStore
		.mixin(createObservableStoreMixin())
		.mixin(createQueryMixin())
		.mixin(createTrackableMixin())
		.mixin(createOrderedOperationMixin()) as TrackableQueryStoreFactory;
	let trackableQueryStore: TrackableObservableQueryStore<ItemType, TrackableOptions<ItemType>, UpdateResults<ItemType>>;
	return {
		name: 'createTrackableMixin',
		beforeEach: function() {
			trackableQueryStore = createTrackbleQueryStore({
				data: createData()
			});
		},

		'alternate query and release': function(this: any) {
			const dfd = this.async(1000);
			const trackedCollection = trackableQueryStore
				.filter(function(item) {
					return item.value > 1;
				})
				.sort('value')
				.track();

			let notifiedOnDelete = false;
			let notifiedOnAddition = false;
			let notifiedOnUpdateIntoCollection = false;
			let notifiedOnMoveInCollection = false;

			trackedCollection.observe().subscribe(function(update) {
				try {
					if (!notifiedOnDelete) {
						assert.equal(update.removedFromTracked.length, 1, 'Had wrong number of updates');
						assert.deepEqual(update.removedFromTracked[0], {
							previousIndex: 0,
							item: { id: '2', value: 2, nestedProperty: { value: 2 } },
							id: '2'
						}, 'Didn\'t send proper delete notification');
						notifiedOnDelete = true;
					}
					else if (!notifiedOnAddition) {
						assert.equal(update.addedToTracked.length, 1, 'Had wrong number of additions');
						assert.deepEqual(update.addedToTracked[0], {
							index: 1,
							item: { id: 'new', value: 10, nestedProperty: { value: 10 } },
							id: 'new'
						}, 'Didn\'t send correct update for added item');
						notifiedOnAddition = true;
					}
					else if (!notifiedOnUpdateIntoCollection) {
						assert.equal(update.addedToTracked.length, 1, 'Had wrong number of updates');
						assert.deepEqual(update.addedToTracked[0], {
							index: 1,
							item: { id: 'ignored', value: 5, nestedProperty: { value: 5 } },
							id: 'ignored'
						}, 'Didn\'t send correct update for item moved into tracking by update');
						notifiedOnUpdateIntoCollection = true;
					}
					else if (!notifiedOnMoveInCollection) {
						assert.equal(update.movedInTracked.length, 1, 'Had wrong number of  updates');
						assert.deepEqual(update.movedInTracked[0], {
							index: 1,
							previousIndex: 2,
							item: { id: 'new', value: 4, nestedProperty: { value: 10 }},
							id: 'new'
						}, 'Didn\'t send correct update for item moved within tracking');
						dfd.resolve();
					}
				} catch (error) {
					dfd.reject(error);
				}
			});

			trackableQueryStore.delete('2').then<StoreObservable<ItemType, UpdateResults<ItemType>>>(function() {
				return trackableQueryStore.add({ id: 'new', value: 10, nestedProperty: { value: 10 }});
			}).then(function() {
				// Shouldn't create a notification
				return trackableQueryStore.add({ id: 'ignored', value: -1, nestedProperty: { value: - 1} });
			}).then(function() {
				return trackableQueryStore.put({
					id: 'ignored',
					value: 5,
					nestedProperty: {
						value: 5
					}
				});
				// return trackableQueryStore.patch({
				// 	id: 'ignored',
				// 	patch: createPatch([
				// 		createOperation(OperationType.Replace, createPointer('value'), 5) ,
				// 		createOperation(OperationType.Replace, createPointer('nestedProperty', 'value'), 5)
				// 	])
				// });
			}).then(function() {
				trackableQueryStore.put({
					id: 'new',
					value: 4,
					nestedProperty: {
						value: 10
					}
				});
			});
		}
	};
});
