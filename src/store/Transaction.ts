import { Store } from './createMemoryStore';
import createStoreObservable, { StoreObservable } from './createStoreObservable';
import Patch from '../patch/Patch';
import Map from 'dojo-shim/Map';
import { Observable } from 'rxjs';
import { StoreActionResult } from '../storeActions/StoreAction';

// TODO - Update Transactions to work with store action manager and store actions
export interface Transaction<T, O> {
	abort(): Store<T, O>;
	commit(): StoreObservable<T>;
	add(items: T[] | T, options?: O): Transaction<T, O>;
	put(items: T[] | T, options?: O): Transaction<T, O>;
	patch(updates: Map<string, Patch<T, T>>, options?: O): Transaction<T, O>;
	delete(ids: string[] | string): Transaction<T, O>;
}

export class SimpleTransaction<T, O> implements Transaction<T, O> {
	protected store: Store<T, O>;
	protected actions: Array<() => Observable<StoreActionResult<T>>>;
	constructor(store: Store<T, O>) {
		this.actions = [];
		this.store = store;
	}

	put(items: T[] | T, options?: O) {
		this.actions.push(() => {
			return this.store.put(items, options);
		});
		return this;
	}

	patch(updates: Map<string, Patch<T, T>>, options?: O) {
		this.actions.push(() => {
			return this.store.patch(updates);
		});
		return this;
	}

	add(items: T[]| T, options?: O) {
		this.actions.push(() => {
			return this.store.add(items, options);
		});
		return this;
	}

	delete(ids: string[] | string) {
		this.actions.push(() => {
			return this.store.delete(ids);
		});
		return this;
	}

	commit() {
		return createStoreObservable(Observable.merge(...this.actions.map(function(action) {
			return action();
		})));
	}

	abort() {
		this.actions = [];
		return this.store;
	}
}
