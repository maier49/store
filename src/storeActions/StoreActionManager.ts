import { Store } from '../store/Store';
import { StoreAction, StoreActionResult, isStore, isRejectedAction } from './StoreAction';
import { after } from 'dojo-core/aspect';
import { Observable, Observer } from '@reactivex/RxJS';

interface StoreActionManager<T> {
	readonly store: Store<T>;
	readonly waitingActions: StoreAction<T>[];
	readonly eagerConflictResolution: boolean;
	queue(...actions: StoreAction<T>[]): Observable<StoreActionResult<T>>;
}

class SimpleAggressiveActionManager<T> implements StoreActionManager<T> {
	store: Store<T>;
	waitingActions: StoreAction<T>[] = [];
	eagerConflictResolution = false;
	private observable: Observable<StoreActionResult<T>>;
	constructor(store: Store<T>) {
		const self = <SimpleAggressiveActionManager<T>> this;
		this.store = store;
		this.observable = new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
			let processing = false;
			function processNext() {
				if (self.waitingActions.length) {
					processing = true;
					const nextAction = self.waitingActions.shift();
					nextAction.do().then(function(actionResult: StoreActionResult<T>) {
						const action = actionResult.action;
						const result = actionResult.result;
						if (isStore<T>(result)) {
							return Promise.resolve(actionResult);
						} else if (isRejectedAction<T>(result)) {
							// Ignores errors and forces overrides
							return result.forceAll().then(store => {
								return {
									result: store,
									action: action
								};
							});
						}
					}).then(function(actionResult: StoreActionResult<T>) {
						observer.next(actionResult);
						processNext();
					});
				} else {
					processing = false;
				}
			}
			after(self, 'queue', function() {
				if (!processing) {
					processNext();
				}
			});
		});
	}

	queue(...actions: StoreAction<T>[]): Observable<StoreActionResult<T>> {
		this.waitingActions.push(...actions);
		const self = <SimpleAggressiveActionManager<T>> this;
		return new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
			const subscription = self.observable.subscribe(function(update: StoreActionResult<T>) {
				let index = actions.indexOf(update.action);
				if (index > -1) {
					observer.next(update);
				}
				if (index === actions.length - 1) {
					observer.complete();
					subscription.unsubscribe();
				}
			});
		});
	}
}
