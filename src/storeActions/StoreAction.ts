import { StoreOperation } from '../store/createMemoryStore';
import { Observable, Observer } from 'rxjs';
import Promise from 'dojo-shim/Promise';
import Patch from '../patch/Patch';
import { PatchMapEntry } from '../patch/Patch';

export const enum UpdateFailureType {
	Conflict,
	NetworkError
}

export interface UpdateResults<T, U extends StoreActionDatum<T>> {
	currentItems?: T[];
	failedData?: StoreActionData<T, U>;
	successfulData: T[] | string[];
	type: StoreOperation;
}

export interface FilteredData<T, U extends StoreActionDatum<T>> {
	currentItems?: T[];
	failedData?: StoreActionData<T, U>;
	data: StoreActionData<T, U>;
}

export type StoreUpdateDataFunction<T, U extends StoreActionDatum<T>> = (data: StoreActionData<T, U>, options?: {}) => Promise<UpdateResults<T, T | string>>;

export interface StoreUpdateResult<T, U extends StoreActionDatum<T>> {
	retry(failedData: StoreActionData<T, U>): Promise<StoreUpdateResult<T, U>>;
	currentItems?: T[];
	failedData?: StoreActionData<T, U>;
	successfulData: T[] | string[];
}

export type StoreUpdateFunction<T, U extends StoreActionDatum<T>> = () => Promise<StoreUpdateResult<T, U>>

export type StoreActionDatum<T> = T | string | PatchMapEntry<T, T>;
export type StoreActionData<T, U extends StoreActionDatum<T>> = U[];

export interface StoreAction<T> {
	do(): Promise<any>;
	observable: Observable<StoreActionResult<T>>;
	type: StoreOperation;
	targetedVersion: number;
	targetedItems: StoreActionData<T, StoreActionDatum<T>>;
}

export interface StoreActionResult<T> {
	readonly retried: boolean;
	withConflicts?: boolean;
	retryAll?: () => void;
	type: StoreOperation;
	filter?: (shouldRetry: (data: StoreActionDatum<T>, currentItem?: T) => boolean) => void;
	successfulData?: T[] | string[];
}

export function createPutAction<T, U extends {}>(
	fn: StoreUpdateFunction<T, T>,
	targetItems: StoreActionData<T, T>,
	version: () => number,
	existingFailures?: StoreActionData<T, T>,
	currentItems?: T[]) {
	return createAction(fn, StoreOperation.Put, targetItems, version, existingFailures, currentItems);
}

export function createAddAction<T>(
	fn: StoreUpdateFunction<T, T>,
	targetItems: StoreActionData<T, T>,
	version: () => number,
	existingFailures?: StoreActionData<T, T>,
	currentItems?: T[]) {
	return createAction(fn, StoreOperation.Add, targetItems, version, existingFailures, currentItems);
}

export function createDeleteAction<T>(
	fn: StoreUpdateFunction<T, string>,
	targetItems: StoreActionData<T, string>,
	version: () => number,
	existingFailures?: StoreActionData<T, string>,
	currentItems?: T[]) {
	return createAction(fn, StoreOperation.Delete, targetItems, version, existingFailures, currentItems);
}

export function createPatchAction<T>(
	fn: StoreUpdateFunction<T, { id: string; patch: Patch<T, T> }>,
	targetItems: StoreActionData<T, { id: string; patch: Patch<T, T> } >,
	version: () => number,
	existingFailures?: StoreActionData<T, { id: string; patch: Patch<T, T> }>,
	currentItems?: T[]) {
	return createAction(fn, StoreOperation.Patch, targetItems, version, existingFailures, currentItems);
}

function createAction<T, U extends StoreActionDatum<T>>(
	fn: StoreUpdateFunction<T, U>,
	type: StoreOperation,
	targetItems: StoreActionData<T, U>,
	version: () => number,
	existingFailures?: StoreActionData<T, U>,
	existingCurrentItems?: T[]): StoreAction<T> {
	let done = false;
	let lastResult: StoreActionResult<T>;
	let observers: Observer<StoreActionResult<T>>[] = [];
	let remove: number[] = [];
	let completedResult: T[] | string[];
	const observable = new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
		if (lastResult) {
			observer.next(lastResult);
		}
		if (lastResult && !lastResult.withConflicts) {
			observer.complete();
		} else {
			observers.push(observer);
		}

		return () => remove.push(observers.indexOf(observer));
	});

	function updateResultToActionResult(
		action: StoreAction<T>,
		result: StoreUpdateResult<T, StoreActionDatum<T>>
	): void {
		let isRetrying = false;
		let inLoop = false;
		const currentItems = [ ...(existingCurrentItems || []), ...(result.currentItems || []) ];
		const failedData = [ ...(existingFailures || []), ...(result.failedData || []) ];

		function throwIfRetryIsForbidden(): void {
			if (lastResult && !lastResult.withConflicts) {
				throw new Error('Cannot retry a successful action');
			}
			if (!inLoop) {
				throw new Error('Action can only be retried synchronously within the "next" callback of the observer');
			}
		}
		if (result.successfulData && result.successfulData.length) {
			if (!completedResult) {
				completedResult = result.successfulData;
			} else {
				completedResult = <string[] | T[]> [ ...result.successfulData, ...completedResult ];
			}
		}

		if (result.failedData.length) {
			lastResult = {
				retried: false,
				type: type,
				withConflicts: true,
				retryAll(this: { retried: boolean }): void {
					throwIfRetryIsForbidden();
					if (this.retried) {
						return;
					}
					this.retried = true;
					if (failedData.length) {
						isRetrying = true;
						result.retry(failedData).then(updateResultToActionResult.bind(null, action));
					}
				},
				filter(this: { retried: boolean }, shouldRetry: (datum: StoreActionDatum<T>, currentItem?: T) => boolean): void {
					throwIfRetryIsForbidden();
					if (this.retried) {
						return;
					}
					this.retried = true;
					const retryFor = failedData.filter(
						(failedDatum, index) => shouldRetry(failedDatum, currentItems[index])
					);
					if (retryFor.length) {
						isRetrying = true;
						result.retry(retryFor).then(updateResultToActionResult.bind(null, action));
					}
				}
			};
		} else {
			lastResult = {
				retried: false,
				withConflicts: false,
				type: type,
				successfulData: completedResult
			};
		}

		inLoop = true;
		observers.forEach(function(observer: Observer<StoreActionResult<T>>) {
			observer.next(lastResult);
		});
		if (!lastResult.withConflicts || !isRetrying) {
			if (lastResult.withConflicts) {
				observers.forEach(function(observer: Observer<StoreActionResult<T>>) {
					observer.next({
						retried: false,
						withConflicts: true,
						type: type,
						successfulData: completedResult
					});
				});
			}
			observers.forEach(function(observer) {
				observer.complete();
			});
		}
		isRetrying = false;
		inLoop = false;
		while (remove.length) {
			observers.splice(remove.pop(), 1);
		}
	}

	return <StoreAction<T>> {
		do(this: StoreAction<T>) {
			if (done) {
				throw Error('This action has already been completed. Cannot perform the same action twice');
			}
			done = true;
			return fn().then(updateResultToActionResult.bind(null, this));
		},
		observable: observable,
		type: type,
		targetedItems: targetItems,
		targetedVersion: version()
	};
}
