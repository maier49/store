import { Store } from './createMemoryStore';
import createStoreObservable, { StoreObservable } from './createStoreObservable';
import Patch from '../patch/Patch';
import Map from 'dojo-shim/Map';
import WeakMap from 'dojo-shim/WeakMap';
import { Observable } from 'rxjs';
import { StoreActionResult } from '../storeActions/StoreAction';
import compose from 'dojo-compose/compose';

// TODO - Update Transactions to work with store action manager and store actions
export interface Transaction<T, O> {
	abort(): Store<T, O>;
	commit(): StoreObservable<T>;
	add(items: T[] | T, options?: O): Transaction<T, O>;
	put(items: T[] | T, options?: O): Transaction<T, O>;
	patch(updates: Map<string, Patch<T, T>>, options?: O): Transaction<T, O>;
	delete(ids: string[] | string): Transaction<T, O>;
}

export interface TransactionOptions<T, O> {
	store?: Store<T, O>;
}

interface TransactionState<T, O> {
	store: Store<T, O>;
	actions: Array<() => Observable<StoreActionResult<{}>>>;
}

const instanceStateMap = new WeakMap<Transaction<{}, {}>, TransactionState<{}, {}>>();

const createTransaction = compose<Transaction<{}, {}>, TransactionOptions<{}, {}>>({

	put(this: Transaction<{}, {}>, items: {}[] | {}, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.put(items, options);
		});
		return this;
	},

	patch(this: Transaction<{}, {}>, updates: Map<string, Patch<{}, {}>>, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.patch(updates);
		});
		return this;
	},

	add(this: Transaction<{}, {}>, items: {}[]| {}, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.add(items, options);
		});
		return this;
	},

	delete(this: Transaction<{}, {}>, ids: string[] | string) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.delete(ids);
		});
		return this;
	},

	commit(this: Transaction<{}, {}>) {
		const state = instanceStateMap.get(this);
		return createStoreObservable(Observable.merge(...state.actions.map(function(action) {
			return action();
		})));
	},

	abort(this: Transaction<{}, {}>) {
		const state = instanceStateMap.get(this);
		state.actions = [];
		return state.store;
	}
}, function<T, O>(instance: Transaction<T, O>, options: TransactionOptions<T, O> = {}) {
	instanceStateMap.set(instance, {
		store: options.store,
		actions: []
	});
});

export default createTransaction;
