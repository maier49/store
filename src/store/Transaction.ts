import { Store, createStoreObservable, StoreObservable } from './Store';
import Patch from '../patch/Patch';
import Map from 'dojo-shim/Map';
import { Observable } from 'rxjs';
import { StoreActionResult } from '../storeActions/StoreAction';

// TODO - Update Transactions to work with store action manager and store actions
export interface Transaction<T> {
	abort(): Store<T>;
	commit(): StoreObservable<T>;
	add(items: T[] | T, options?: {}): Transaction<T>;
	put(items: T[] | T, options?: {}): Transaction<T>;
	patch(updates: Map<string, Patch<T, T>>, options?: {}): Transaction<T>;
	delete(ids: string[] | string): Transaction<T>;
}

export class SimpleTransaction<T> implements Transaction<T> {
	protected store: Store<T>;
	protected actions: Array<() => Observable<StoreActionResult<T>>>;
	constructor(store: Store<T>) {
		this.actions = [];
		this.store = store;
	}

	put(items: T[] | T, options?: {}) {
		this.actions.push(() => {
			return this.store.put(items, options);
		});
		return this;
	}

	patch(updates: Map<string, Patch<T, T>>, options?: {}) {
		this.actions.push(() => {
			return this.store.patch(updates);
		});
		return this;
	}

	add(items: T[]| T, options?: {}) {
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
