import { Store } from './Store';
import Patch from '../patch/Patch';
import Promise from 'dojo-shim/Promise';
import Map from 'dojo-shim/Map';
import { Subject } from '@reactivex/RxJS';

export interface Transaction<T> {
	abort(): Store<T>;
	commit(): Promise<Store<T>>;
	add(...items: T[]): Transaction<T>;
	put(...items: T[]): Transaction<T>;
	patch(updates: Map<string, Patch<T, T>>): Transaction<T>;
	delete(...ids: string[]): Transaction<T>;
}

export class SimpleTransaction<T> implements Transaction<T> {
	protected store: Store<T>;
	protected pause: Subject<any>;
	protected actions: (() => void)[];
	constructor(store: Store<T>, pause: Subject<any>) {
		this.actions = [];
		this.store = store;
		this.pause = pause;
	}

	put(...items: T[]) {
		this.actions.push(() => this.store.put(...items));
		return this;
	}

	patch(updates: Map<string, Patch<T, T>>) {
		this.actions.push(() => this.store.patch(updates));
		return this;
	}

	add(...items: T[]) {
		this.actions.push(() => this.store.add(...items));
		return this;
	}

	delete(...ids: string[]) {
		this.actions.push(() => this.store.delete(...ids));
		return this;
	}

	commit() {
		this.pause.next(false);
		return Promise.all(this.actions.map(action => action())).then(function() {
			this.pause.next(true);
			return this.store;
		}.bind(this));
	}

	abort() {
		this.actions = [];
		return this.store;
	}
}
