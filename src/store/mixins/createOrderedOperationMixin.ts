import { UpdateResults } from '../../storage/createInMemoryStorage';
import { Store, CrudOptions, StoreOptions } from '../createStore';
import { ComposeMixinDescriptor } from 'dojo-compose/compose';
import { Observer, Observable } from 'rxjs';
import createStoreObservable from '../createStoreObservable';

interface OrderedOperationState {
	operationQueue: Promise<any>[];
}

const instanceStateMap = new WeakMap<{}, OrderedOperationState>();

function queueStoreOperation(operation: Function, returnPromise?: boolean) {
	return function(this: any, ...args: any[]) {
		const store = this;
		const state = instanceStateMap.get(store);
		if (!state || this.source) {
			return operation.apply(store, args);
		}
		let lastOperationFinished: Promise<any>;
		if (state.operationQueue.length) {
			lastOperationFinished = state.operationQueue[state.operationQueue.length - 1];
		}
		else {
			lastOperationFinished = Promise.resolve();
		}
		if (returnPromise) {
			const operationPromise = lastOperationFinished.then(function() {
				return operation.apply(store, args).then(function(results: any) {
					state.operationQueue.splice(state.operationQueue.indexOf(operationPromise), 1);
					return results;
				});
			});
			state.operationQueue.push(operationPromise);

			return operationPromise;
		}
		else {
			let observable: Observable<any>;
			return createStoreObservable(
				new Observable<UpdateResults<{}>>(function subscribe(observer: Observer<UpdateResults<{}>>) {
					if (!observable) {
						const operationPromise = lastOperationFinished.then(function() {
							return new Promise(function(resolve, reject) {
								setTimeout(function() {
									observable = operation.apply(store, args);
									observable.subscribe(function onNext(next: any) {
										observer.next(next);
									}, function onError(error: any) {
										observer.error(error);
										reject(error);
									}, function onComplete() {
										observer.complete();
										state.operationQueue.splice(state.operationQueue.indexOf(operationPromise), 1);
										resolve();
									});
								});
							});
						});
						state.operationQueue.push(operationPromise);
					}
				}), function(updateResults: UpdateResults<{}>) {
					return updateResults.successfulData;
				}
			);
		}
	};
}

function createOrderedOperationMixin<T, O extends CrudOptions, U extends UpdateResults<T>>(): ComposeMixinDescriptor<
	Store<T, O, U>, StoreOptions<T, O>, Store<T, O, U>, StoreOptions<T, O>
> {
	return {
		aspectAdvice: {
			around: {
				put(put: Function) {
					return queueStoreOperation(put);
				},

				add(add: Function) {
					return queueStoreOperation(add);
				},

				patch(patch: Function) {
					return queueStoreOperation(patch);
				},

				delete(_delete: Function) {
					return queueStoreOperation(_delete);
				},

				fetch(fetch: Function) {
					return queueStoreOperation(fetch, true);
				}
			}
		},
		initialize(instance: Store<T, O, U>) {
			instanceStateMap.set(instance, {
				operationQueue: []
			});
		}
	};
}

export default createOrderedOperationMixin;
