import { Store, BaseStore, Update } from './Store';
import { Patch } from '../patch/Patch';
import Promise from 'dojo-shim/Promise';
import { Observer } from 'rxjs/Observer';
import { Handle } from 'dojo-core/interfaces';
import { around } from 'dojo-core/aspect';

export interface Transaction<T, U> {
	abort(): Store<T>
	commit(): Promise<Store<T>>;
	add(...items: T[]): Transaction<T, U>;
	put(...items: T[]): Transaction<T, U>;
	patch(updates: Map<string, Patch>): Transaction<T, U>;
	delete(...ids: string[]): Transaction<T, U>;
}

export class SimpleTransaction<T> implements Transaction<T, U> {
	protected store: Store<T>;
	protected pause: Observer<any>;
	protected actions: (() => void)[];
	constructor(store: Store<T>, pause: Observer<any>) {
		this.actions = [];
		this.store = store;
		this.pause = pause;
	}

	put(...items: T[]) {
		this.actions.push(() => this.store.put(...items));
		return this;
	}

	patch(updates: Map<string, Patch>) {
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
		this.pause.onNext(false);
		return Promise.all(this.actions.map(action => action())).then(function() {
			this.pause.onNext(true);
			return this.store;
		}.bind(this));
	}

	abort() {
		this.actions = [];
		return this.store;
	}
}
