import { Store, BaseStore, Update } from './Store';
import { Patch } from '../patch/Patch';
import Promise from 'dojo-shim/Promise';
import { Handle } from 'dojo-core/interfaces';
import { around } from 'dojo-core/aspect';

export interface Transaction<T, U extends BaseStore<T>> {
	abort(): Store<T, U>
	commit(): Store<T>;
	add(...items: T[]): Transaction<T>;
	put(...items: T[]): Transaction<T>;
	put(...updates: Map<string, Patch>[]): Transaction<T>;
	delete(...ids: string[]): Promise<string[]>;
}

export class SimpleTransaction<T, U extends BaseStore<T>> implements Transaction<T, U> {
	protected store: BaseStore<T, U>;
	protected actions: (() => void)[];
	constructor(store: BaseStore<T, U>) {
		this.actions = [];
		this.store = store;
	}

	put(...args: any[]) {
		this.actions.push(() => this.store.put(...args));
		return this;
	}

	add(...args: any[]) {
		this.actions.push(() => this.store.add(...args));
		return this;
	}


	delete(...args: any[]) {
		this.actions.push(() => this.store.delete(...args));
		return this;
	}

	commit() {
		batchUpdates(this.store, this.actions);
		return this.store;
	}

	abort() {
		this.actions = [];
		return this.store;
	}
}


export function batchUpdates<T, U>(store: BaseStore<T, any>, actions: (() => U)[]): U[] {
	let updates: Update<T>[] = [];
	const aggregateHandle: Handle = around(store, 'handleUpdates', () => {
		return (newUpdates: Update<T>[]) => updates = [ ...updates, ...newUpdates ];
	});
	const toReturn: U[] = actions.map(action => action());
	aggregateHandle.destroy();
	store.handleUpdates(updates);
	return toReturn;
}
