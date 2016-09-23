import Promise from 'dojo-shim/Promise';
import { Observable } from 'rxjs';
import { StoreActionResult } from '../storeActions/StoreAction';

/**
 * Adds a then method to the observable for those consumers of the store API who
 * only want to know about the end result of an operation, and don't want to deal with
 * any recoverable failures.
 */
export interface StoreObservable<T> extends Observable<StoreActionResult<T>> {
	then<U>(onFulfilled?: ((value?: T[] | string[]) => (U | Promise<U> | null | undefined)) | null | undefined, onRejected?: (reason?: Error) => void): Promise<U>;
}

export default function createStoreObservable<T>(observable: Observable<StoreActionResult<T>>): StoreObservable<T> {
	const storeObservable = observable as StoreObservable<T>;
	storeObservable.then = function<U>(onFulfilled?: ((value?: T[] | string[]) => (U | Promise<U> | null | undefined)) | null | undefined, onRejected?: (reason?: Error) => void): Promise<U> {
		// Wrap in a shim promise because the interface that leaks through observable.toPromise is missing some
		// properties on the shim(e.g. promise)
		return Promise.resolve(storeObservable.toPromise()).then(function(result) {
			if (!result.successfulData) {
				throw new Error('All data failed to update due to conflicts');
			}

			return result.successfulData;
		}).then<U>(onFulfilled, onRejected);
	};

	return storeObservable;
}
