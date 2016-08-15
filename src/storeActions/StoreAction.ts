import { Store, BatchUpdate } from '../store/Store';
import { Observable, Observer } from 'rxjs';
import Promise from 'dojo-shim/Promise';
import Patch from '../patch/Patch';

export const enum StoreActionType {
	Add,
	Put,
	Patch,
	Delete,
	Compound
}

export interface StoreUpdateResultData<T, U extends StoreActionDatum<T>> {
	currentItems?: T[];
	failedData?: StoreActionData<T, U>;
	successfulData: BatchUpdate<T>;
}

export type FilteredData<T, U extends StoreActionDatum<T>> = {
	currentItems?: T[];
	failedData?: StoreActionData<T, U>;
	data: StoreActionData<T, U>
}

export type StoreUpdateDataFunction<T, U extends StoreActionDatum<T>> = (data: StoreActionData<T, U>) => Promise<StoreUpdateResultData<T, U>>;

export interface StoreUpdateResult<T, U extends StoreActionDatum<T>> extends StoreUpdateResultData<T, U> {
	retry(failedData: StoreActionData<T, U>): Promise<StoreUpdateResult<T, U>>;
	store: Store<T>;
}

export type StoreUpdateFunction<T, U extends StoreActionDatum<T>> = () => Promise<StoreUpdateResult<T, U>>

export type StoreActionDatum<T> = T | string | { id: string, patch: Patch<T, T> };
export type StoreActionData<T, U extends StoreActionDatum<T>> = U[];

export interface StoreAction<T> {
	do(): Promise<any>;
	observable: Observable<StoreActionResult<T>>;
	type: StoreActionType;
	targetedVersion: number;
	targetedItems: StoreActionData<T, StoreActionDatum<T>>;
}

export interface StoreActionResult<T> {
	readonly retried: boolean;
	action: StoreAction<T>;
	withErrors: boolean;
	retryAll(): void;
	type: StoreActionType;
	filter(shouldRetry: (data: StoreActionDatum<T>, currentItem?: T) => boolean): void;
	store: Store<T>;
	successfulData: BatchUpdate<T>;
}

export function createPutAction<T>(
	fn: StoreUpdateFunction<T, T>,
	targetItems: StoreActionData<T, T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T, T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Put, targetItems, store, existingFailures, currentItems);
}

export function createAddAction<T>(
	fn: StoreUpdateFunction<T, T>,
	targetItems: StoreActionData<T, T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T, T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Add, targetItems, store, existingFailures, currentItems);
}

export function createDeleteAction<T>(
	fn: StoreUpdateFunction<T, string>,
	targetItems: StoreActionData<T, string>,
	store: Store<T>,
	existingFailures?: StoreActionData<T, string>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Delete, targetItems, store, existingFailures, currentItems);
}

export function createPatchAction<T>(
	fn: StoreUpdateFunction<T, { id: string; patch: Patch<T, T> }>,
	targetItems: StoreActionData<T, { id: string; patch: Patch<T, T> } >,
	store: Store<T>,
	existingFailures?: StoreActionData<T, { id: string; patch: Patch<T, T> }>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Patch, targetItems, store, existingFailures, currentItems);
}

function createAction<T, U extends StoreActionDatum<T>>(
	fn: StoreUpdateFunction<T, U>,
	type: StoreActionType,
	targetItems: StoreActionData<T, U>,
	store: Store<T>,
	existingFailures?: StoreActionData<T, U>,
	existingCurrentItems?: T[]): StoreAction<T> {
	let done = false;

	let lastResult: StoreActionResult<T>;
	let observers: Observer<StoreActionResult<T>>[] = [];
	let remove: number[] = [];
	const observable = new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
		if (lastResult) {
			observer.next(lastResult);
		}
		if (lastResult && !lastResult.withErrors) {
			observer.complete();
		} else {
			observers.push(observer);
		}

		return () => remove.push(observers.indexOf(observer));
	});

	function updateResultToActionResult (
		action: StoreAction<T>,
		result: StoreUpdateResult<T, StoreActionDatum<T>>): void {
		const currentItems = [ ...(existingCurrentItems || []), ...(result.currentItems || []) ];
		const failedData = [ ...(existingFailures || []), ...(result.failedData || []) ];
		lastResult = {
			retried: false,
			action: action,
			type: type,
			withErrors: Boolean(result.failedData.length),
			retryAll() {
				if (!this.retried && (!lastResult || lastResult.withErrors)) {
					this.retried = true;
					result.retry(failedData).then(updateResultToActionResult.bind(null, action));
				}
			},
			filter(shouldRetry: (datum: StoreActionDatum<T>, currentItem?: T) => boolean) {
				if (!this.retried && (!lastResult || lastResult.withErrors)) {
					this.retried = true;
					result.retry(
						failedData.filter((failedDatum, index) => shouldRetry(failedDatum, currentItems && currentItems[index]))
					).then(updateResultToActionResult.bind(null, action));
				}
			},
			store: result.store,
			successfulData: result.successfulData
		};

		observers.forEach(function(observer: Observer<StoreActionResult<T>>) {
			observer.next(lastResult);
			if (!lastResult.withErrors) {
				observer.complete();
			}
		});
		while (remove.length) {
			observers.splice(remove.pop(), 1);
		}
	}

	return <StoreAction<T>> {
		do() {
			if (done) {
				throw Error('This action has alrady been completed. Cannot perform the same action twice');
			}
			done = true;
			const self = <StoreAction<T>> this;
			return fn().then(updateResultToActionResult.bind(null, self));
		},
		observable: observable,
		type: type,
		targetedItems: targetItems,
		targetedVersion: store.version
	};
}
