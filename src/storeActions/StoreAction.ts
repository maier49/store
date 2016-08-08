import { Store, ItemAdded, ItemUpdated, ItemDeleted } from '../store/Store';
import Promise from 'dojo-shim/Promise';
import Patch from '../patch/Patch';

export const enum StoreActionType {
	Add,
	Put,
	Patch,
	Delete,
	Compound
}

export interface StoreUpdateResult<T> {
	currentItems: T[];
	retry(failedData: StoreActionData<T>): Promise<StoreUpdateResult<T>>;
	failedData: StoreActionData<T>;
	successfulData: SuccessfulOperation<T>[];
	store: Store<T>;
}

export type StoreUpdateFunction<T> = () => Promise<StoreUpdateResult<T>>

export type StoreActionDatum<T> = T | string | { id: string, patch: Patch<T, T> };
export type StoreActionData<T> = StoreActionDatum<T>[];
export type SuccessfulOperation<T> = ItemAdded<T> | ItemUpdated<T> | ItemDeleted;

export interface StoreAction<T> {
	do(): Promise<StoreActionResult<T>>;
	type: StoreActionType;
	targetedVersion: number;
	targetedItems: StoreActionData<T>;
}

export interface StoreActionResult<T> {
	action: StoreAction<T>;
	withErrors: boolean;
	retryAll?(): Promise<StoreActionResult<T>>;
	type: StoreActionType;
	filter?(shouldRetry: (data: StoreActionDatum<T>, currentItem?: T) => boolean): Promise<StoreActionResult<T>>;
	store: Store<T>;
	successfulData: SuccessfulOperation<T>[];
}

export function createPutAction<T>(
	fn: StoreUpdateFunction<T>,
	targetItems: StoreActionData<T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Put, targetItems, store, existingFailures, currentItems);
}

export function createAddAction<T>(
	fn: StoreUpdateFunction<T>,
	targetItems: StoreActionData<T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Add, targetItems, store, existingFailures, currentItems);
}

export function createDeleteAction<T>(
	fn: StoreUpdateFunction<T>,
	targetItems: StoreActionData<T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Delete, targetItems, store, existingFailures, currentItems);
}

export function createPatchAction<T>(
	fn: StoreUpdateFunction<T>,
	targetItems: StoreActionData<T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T>,
	currentItems?: T[]) {
	return createAction(fn, StoreActionType.Patch, targetItems, store, existingFailures, currentItems);
}

function updateResultToActionResult<T>(
	action: StoreAction<T>,
	type: StoreActionType,
	existingFailures: StoreActionData<T>,
	existingCurrentItems: T[],
	result: StoreUpdateResult<T>): StoreActionResult<T> {
	const currentItems = [ ...(existingCurrentItems || []), ...result.currentItems ];
	const failedData = [ ...(existingFailures || []), ...result.failedData ];
	return <StoreActionResult<T>> {
		action: action,
		type: type,
		withErrors: Boolean(result.failedData),
		retryAll() {
			return result.retry(failedData).then(updateResultToActionResult.bind(null, type));
		},
		filter: (shouldRetry: (datum: StoreActionDatum<T>, currentItem?: T) => boolean) =>
			result.retry(
				failedData.filter((failedDatum, index) => shouldRetry(failedDatum, currentItems[index]))
			).then(updateResultToActionResult.bind(null, type)),
		store: result.store,
		successfulData: result.successfulData
	};
}

function createAction<T>(
	fn: StoreUpdateFunction<T>,
	type: StoreActionType,
	targetItems: StoreActionData<T>,
	store: Store<T>,
	existingFailures?: StoreActionData<T>,
	currentItems?: T[]): StoreAction<T> {
	let done = false;
	return {
		do() {
			if (done) {
				throw Error('This action has alrady been completed. Cannot perform the same action twice');
			}
			done = true;
			const self = <StoreAction<T>> this;
			return fn().then(updateResultToActionResult.bind(null, self, type, existingFailures, currentItems));
		},
		type: type,
		targetedItems: targetItems,
		targetedVersion: store.version
	};
}
