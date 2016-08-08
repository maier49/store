import {Store} from '../store/Store';
import {StoreAction, StoreActionResult} from './StoreAction';
import {after} from 'dojo-core/aspect';
import {Observable, Observer} from '@reactivex/RxJS';
import Promise from 'dojo-shim/Promise';

interface StoreActionManager<T> {
	readonly store: Store<T>;
	readonly waitingActions: StoreAction<T>[];
	queue(action: StoreAction<T>): Promise<StoreActionResult<T>>;
	queue(actions: StoreAction<T>[]): Observable<StoreActionResult<T>>;
	handleFailure(failedAction: StoreActionResult<T>): Promise<StoreActionResult<T>>;
}

export default StoreActionManager;

export abstract class BaseActionManager<T> implements StoreActionManager<T> {
	store: Store<T>;
	waitingActions: StoreAction<T>[] = [];
	private observable: Observable<StoreActionResult<T>>;

	abstract handleFailure(failedAction: StoreActionResult<T>): Promise<StoreActionResult<T>>;

	constructor(store: Store<T>) {
		const self = <BaseActionManager<T>> this;
		this.store = store;

		this.observable = new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
			let processing = false;

			function processNext() {
				if (self.waitingActions.length) {
					processing = true;
					const nextAction = self.waitingActions.shift();
					nextAction.do().then(function(actionResult: StoreActionResult<T>) {
						if (actionResult.withErrors) {
							// Ignores errors and forces retries
							return this.handleFailure(actionResult);
						} else {
							return actionResult;
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

	queue(action: StoreAction<T>): Promise<StoreActionResult<T>>;
	queue(actions: StoreAction<T>[]): Observable<StoreActionResult<T>>;
	queue(actionOrActions: StoreAction<T> | StoreAction<T>[]): Promise<StoreActionResult<T>> | Observable<StoreActionResult<T>> {
		const self = <BaseActionManager<T>> this;
		if (actionOrActions instanceof Array) {
			this.waitingActions.push(...(<StoreAction<T>[]> actionOrActions));
			return new Observable<StoreActionResult<T>>(function(observer: Observer<StoreActionResult<T>>) {
				const subscription = self.observable.subscribe(function(update: StoreActionResult<T>) {
					let index = (<Array<any>> actionOrActions).indexOf(update.action);
					if (index > -1) {
						observer.next(update);
					}
					if (index === (<Array<any>> actionOrActions).length - 1) {
						observer.complete();
						subscription.unsubscribe();
					}
				});
			});
		} else {
			this.waitingActions.push(<StoreAction<T>> actionOrActions);
			return new Promise(function(resolve) {
				const subscription = self.observable.subscribe(function(update: StoreActionResult<T>) {
					if (update.action === actionOrActions) {
						subscription.unsubscribe();
						resolve(update);
					}
				});
			});
		}
	}
}

export class AggressiveActionManager<T> extends BaseActionManager<T> {
	private persistence: number;

	private retry(actionResult: StoreActionResult<T>, count: number): Promise<StoreActionResult<T>> {
		if (count > this.persistence || !actionResult.withErrors) {
			return Promise.resolve(actionResult);
		} else {
			return actionResult.retryAll().then(actionResult => this.retry(actionResult, count + 1));
		}
	}

	constructor(store: Store<T>, persistence?: number) {
		super(store);
		this.persistence = typeof persistence === 'number' ? Math.min(100, Math.abs(persistence)) : 10;
	}

	handleFailure(failedAction: StoreActionResult<T>): Promise<StoreActionResult<T>> {
		return this.retry(failedAction, 1);
	}
}

export class PassthroughActionManager<T> extends BaseActionManager<T> {
	handleFailure(failedAction: StoreActionResult<T>) {
		return Promise.resolve(failedAction);
	}
}
