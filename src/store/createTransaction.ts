import {Store, CrudOptions} from './createStore';
import createStoreObservable, { StoreObservable } from './createStoreObservable';
import Patch from '../patch/Patch';
import Map from 'dojo-shim/Map';
import { Observable } from 'rxjs';
import compose from 'dojo-compose/compose';
import { UpdateResults } from '../storage/createInMemoryStorage';

// TODO - Update Transactions to work with store action manager and store actions
export interface Transaction<T, O extends CrudOptions, U extends UpdateResults<T>> {
	abort(): Store<T, O, U>;
	commit(): StoreObservable<T | string, U[]>;
	add(items: T[] | T, options?: O): Transaction<T, O, U>;
	put(items: T[] | T, options?: O): Transaction<T, O, U>;
	patch(updates: Map<string, Patch<T, T>> | { id: string; patch: Patch<T, T> } | { id: string; patch: Patch<T, T> }[], options?: O): Transaction<T, O, U>;
	delete(ids: string[] | string): Transaction<T, O, U>;
}

export interface TransactionOptions<T, O, U extends UpdateResults<T>> {
	store?: Store<T, O, U>;
}

interface TransactionState<T, O extends CrudOptions, U extends UpdateResults<T>> {
	store: Store<T, O, U>;
	actions: Array<() => StoreObservable<T | string, U>>;
}

const instanceStateMap = new WeakMap<Transaction<{}, {}, UpdateResults<{}>>, TransactionState<{}, {}, UpdateResults<{}>>>();

const createTransaction = compose<Transaction<{}, {}, UpdateResults<{}>>, TransactionOptions<{}, {}, UpdateResults<{}>>>({
	put(this: Transaction<{}, {}, UpdateResults<{}>>, items: {}[] | {}, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.put(items, options);
		});
		return this;
	},

	patch(this: Transaction<{}, {}, UpdateResults<{}>>, updates: Map<string, Patch<{}, {}>>, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.patch(updates);
		});
		return this;
	},

	add(this: Transaction<{}, {}, UpdateResults<{}>>, items: {}[]| {}, options?: {}) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.add(items, options);
		});
		return this;
	},

	delete(this: Transaction<{}, {}, UpdateResults<{}>>, ids: string[] | string) {
		const state = instanceStateMap.get(this);
		state.actions.push(() => {
			return state.store.delete(ids);
		});
		return this;
	},

	commit(this: Transaction<{}, {}, UpdateResults<{}>>) {
		const state = instanceStateMap.get(this);
		return createStoreObservable<{} | string, UpdateResults<{}>[]>(Observable.zip<UpdateResults<{}>[]>(...state.actions.map(function(action) {
			return action();
		})), function(updateResultsList) {
			return updateResultsList.reduce(function(prev, next) {
				return next.successfulData ? prev.concat(next.successfulData) : prev;
			}, []);
		});
	},

	abort(this: Transaction<{}, {}, UpdateResults<{}>>) {
		const state = instanceStateMap.get(this);
		state.actions = [];
		return state.store;
	}
}, function<T, O, U extends UpdateResults<T>>(instance: Transaction<T, O, U>, options: TransactionOptions<T, O, U> = {}) {
	instanceStateMap.set(instance, {
		store: options.store,
		actions: []
	});
});

export default createTransaction;
