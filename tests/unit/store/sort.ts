import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import { createSort } from '../../../src/query/Sort';
import { createPointer } from '../../../src/patch/JsonPointer';

type SimpleObj = { key1: string; id: number };
type NestedObj = { key1: { key2: string }; id: number}

const simpleList = [
	{
		key1: 'b',
		id: 1
	},
	{
		key1: 'c',
		id: 2
	},
	{
		key1: 'a',
		id: 3
	}
];
const nestedList = [
	{
		key1: {
			key2: 'b'
		},
		id: 1
	},
	{
		key1: {
			key2: 'c'
		},
		id: 2
	},
	{
		key1: {
			key2: 'a'
		},
		id: 3
	}
];

registerSuite({
	name: 'sort',

	'wort with property': {
		'sort in default order': function() {
			assert.deepEqual(createSort<SimpleObj>('key1').apply(simpleList),
				[ { key1: 'a', id: 3 }, { key1: 'b', id: 1 }, { key1: 'c', id: 2 } ]);
		},
		'sort in ascending order': function() {
			assert.deepEqual(createSort<SimpleObj>('key1', false).apply(simpleList),
				[ { key1: 'a', id: 3 }, { key1: 'b', id: 1 }, { key1: 'c', id: 2 } ]);
		},
		'sort in decending order': function() {
			assert.deepEqual(createSort<SimpleObj>('key1', true).apply(simpleList),
				[ { key1: 'c', id: 2 }, { key1: 'b', id: 1 }, { key1: 'a', id: 3 } ]);
		}
	},
	'sort with json path': {
		'sort with one path': function() {
			assert.deepEqual(createSort<SimpleObj>(createPointer('key1')).apply(simpleList),
				[ { key1: 'a', id: 3 }, { key1: 'b', id: 1 }, { key1: 'c', id: 2 } ]);
		},
		'sort with multiple paths': function() {
			assert.deepEqual(createSort<NestedObj>(createPointer('key1', 'key2')).apply(nestedList),
				[ { key1: { key2: 'a' }, id: 3 }, { key1: { key2: 'b' }, id: 1 }, { key1: { key2: 'c' }, id: 2 } ]);
		}
	},
	'sort with comparator': {
		'sort with default order': function() {
			assert.deepEqual(createSort<SimpleObj>((a, b) => b.id - a.id).apply(simpleList),
				[ { key1: 'a', id: 3 }, { key1: 'c', id: 2 }, { key1: 'b', id: 1 } ]);
		},
		'sort with flipped order': function() {
			assert.deepEqual(createSort<SimpleObj>((a, b) => b.id - a.id, true).apply(simpleList),
				[ { key1: 'b', id: 1 }, { key1: 'c', id: 2 }, { key1: 'a', id: 3 } ]);
		}
	}
});
