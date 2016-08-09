import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import MemoryStore from '../../../src/store/MemoryStore';
import {Store, MultiUpdate, ItemsAdded} from '../../../src/store/Store';
import { createPointer } from '../../../src/patch/JsonPointer';
import {CompoundQuery} from '../../../src/query/Query';
import {createFilter} from '../../../src/query/Filter';
import {createSort} from '../../../src/query/Sort';

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
				assert.deepEqual(fetchedData, [ data[1], data[0] ], 'Data fetched with queries was incorrect');
				dfd.resolve();
			});
	},

	'observation': {
		'should be able to observe the store'() {
			const dfd = this.async(10000);
			const store: Store<ItemType> = new MemoryStore<ItemType>();
			store.observe().subscribe(function(update: MultiUpdate<ItemType>) {
				assert.strictEqual(update.type, 'add', 'Should have received a notification about updates');
				assert.deepEqual((<ItemsAdded<ItemType>> update).updates.map(update => update.item), data,
					'Should have received an update for all three items added');
				dfd.resolve();
			});

			store.add(...data);
		}
	}
});
