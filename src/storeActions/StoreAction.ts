import { Store } from '../store/Store';
import Promise from 'dojo-shim/Promise';
import Patch from '../patch/Patch';

export const enum StoreActionType {
	Add,
	Put,
	Patch,
	Delete
}

export interface StoreActionError<T> {
	currentItems: T[];
	forceAction(failedData: StoreActionData<T>[]): Promise<Store<T>>;
	failedData: StoreActionData<T>[];
}

export type StoreActionResultData<T> = Store<T> | RejectedAction<T>;
export type StoreActionResult<T> = { action: StoreAction<T>; result: StoreActionResultData<T>};
export type StoreActionData<T> = T | string | Patch<T, T>;

export function isStore<T>(actionResult: StoreActionResultData<T>): actionResult is Store<T> {
	return !(<any> actionResult).type &&
		!(<any> actionResult).forceAll &&
		!(<any> actionResult).filter;
}

export function isRejectedAction<T>(actionResult: StoreActionResultData<T>): actionResult is RejectedAction<T> {
	return (<any> actionResult).type &&
		(<any> actionResult).forceAll &&
		(<any> actionResult).targets &&
		(<any> actionResult).targetedVersion;
}

export interface AddOrPutError<T> extends StoreActionError<T> {
	failedData: T[];
}

export interface DeleteError<T> extends StoreActionError<T> {
	failedData: string[];
}

export interface PatchError<T> extends StoreActionError<T> {
	failedData: Patch<T, T>[];
}

export interface StoreAction<T> {
	do(): Promise<StoreActionResult<T>>;
	type: StoreActionType;
	targetedVersion: number;
	targets: StoreActionData<T>[];
}

export interface RejectedAction<T> {
	forceAll(): Promise<Store<T>>;
	type: StoreActionType;
	filter(shouldForce: (data: StoreActionData<T>, currentItem: T) => boolean): Promise<Store<T>>;
}

export function createPutAction<T>(fn: () => Promise<Store<T>>, items: T[], store: Store<T>) {
	return createAction(fn, items, store, StoreActionType.Put);
}

export function createAddAction<T>(fn: () => Promise<Store<T>>, items: T[], store: Store<T>) {
	return createAction(fn, items, store, StoreActionType.Add);
}

export function createDeleteAction<T>(fn: () => Promise<Store<T>>, ids: string[], store: Store<T>) {
	return createAction(fn, ids, store, StoreActionType.Delete);
}

export function createPatchAction<T>(fn: () => Promise<Store<T>>, patches: Patch<T, T>[], store: Store<T>) {
	return createAction(fn, patches, store, StoreActionType.Patch);
}

function createAction<T>(fn: () => Promise<Store<T>>, data: StoreActionData<T>[], store: Store<T>, type: StoreActionType): StoreAction<T> {
	return {
		do: function() {
			const self = <StoreAction<T>> this;
			return fn().then((successfulResult: Store<T>) => store).catch<StoreActionResult<T>>(function(failed: any) {
				let error = <StoreActionError<T>> failed;
				if (!error.failedData) {
					// If we don't recognize the error, propagate it out
					throw error;
				}
				return {
					action: self,
					result: {
						type: type,
						forceAll: function () {
							return error.forceAction(error.failedData);
						},
						filter: (shouldForce: (datum: StoreActionData<T>, currentItem: T) => boolean) =>
							error.forceAction(error.failedData.filter((datum: StoreActionData<T>, index: number) =>
								shouldForce(datum, error.currentItems[index]))
							)
					}
				};
			});
		},
		targetedVersion: store.version,
		type: type,
		targets: data
	};
}
