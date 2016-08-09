import { StoreAction, StoreActionResult, StoreUpdateFunction, StoreUpdateResult } from './StoreAction';
import { after }  from 'dojo-core/aspect';
import Promise from 'dojo-shim/Promise';

interface StoreActionManager<T> {
	readonly waitingActionsAndUpdates: Array<StoreAction<T> | StoreUpdateFunction<T>>;
	queue(action: StoreAction<T>): void;
	queue(updateFunction: StoreUpdateFunction<T>): Promise<StoreUpdateResult<T>>;
	queue(actions: StoreAction<T>[]): void;
	actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;
}

export default StoreActionManager;

function isAction<T>(updateOrAction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T>): updateOrAction is StoreAction<T> {
	return typeof (<any> updateOrAction).do === 'function';
}

function isUpdate<T>(updateOrAction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T>): updateOrAction is StoreUpdateFunction<T> {
	return typeof updateOrAction === 'function';
}

export abstract class BaseActionManager<T> implements StoreActionManager<T> {
	waitingActionsAndUpdates: Array<StoreAction<T> | StoreUpdateFunction<T>> = [];

	abstract actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;

	constructor() {
		const self = <BaseActionManager<T>> this;

		let processing = false;
		function processNext() {
			if (self.waitingActionsAndUpdates.length) {
				processing = true;
				const nextActionOrUpdate = self.waitingActionsAndUpdates.shift();
				if (isAction(nextActionOrUpdate)) {
					self.actionManager(nextActionOrUpdate, processNext);
					nextActionOrUpdate.do();
				} else {
					nextActionOrUpdate();
					processNext();
				}
			} else {
				processing = false;
			}
		}

		after(self, 'queue', function() {
			if (!processing) {
				processNext();
			}
		});
	}
	queue(updateFunction: StoreUpdateFunction<T>): Promise<StoreUpdateResult<T>>;
	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	queue(actionActionsOrUpdateFunction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T>): void | Promise<StoreUpdateResult<T>> {
		if (actionActionsOrUpdateFunction instanceof Array) {
			this.waitingActionsAndUpdates.push(...(<StoreAction<T>[]> actionActionsOrUpdateFunction));
		} else if (isAction(actionActionsOrUpdateFunction)) {
			this.waitingActionsAndUpdates.push(actionActionsOrUpdateFunction);
		} else if (isUpdate(actionActionsOrUpdateFunction)) {
			const self = <StoreActionManager<T>> this;
			return new Promise(function(resolve) {
				self.waitingActionsAndUpdates.push(function(): Promise<StoreUpdateResult<T>> {
					return (<StoreUpdateFunction<T>> actionActionsOrUpdateFunction)()
						.then(function(result: StoreUpdateResult<T>) {
							resolve(result);
							return result;
						});
				});
			});
		}
	}
}

export class SyncAggressiveActionManager<T> extends BaseActionManager<T> {
	private persistence: number;

	constructor(persistence?: number) {
		super();
		this.persistence = typeof persistence === 'number' ? Math.min(100, Math.abs(persistence)) : 10;
	}

	actionManager(action: StoreAction<T>, completedCallback: () => void) {
		let count = 1;
		const subscription = action.observable.subscribe(function(result: StoreActionResult<T>) {
			if (!result.withErrors || count > this.persistence) {
				subscription.unsubscribe();
				completedCallback();
			} else {
				count ++;
				result.retryAll();
			}
		});
	}
}

export class AsyncAgressiveActionManager<T> extends BaseActionManager<T> {
	private persistence: number;

	constructor(persistence?: number) {
		super();
		this.persistence = typeof persistence === 'number' ? Math.min(100, Math.abs(persistence)) : 10;
	}

	actionManager(action: StoreAction<T>, completedCallback: () => void) {
		let count = 1;
		const subscription = action.observable.subscribe(function(result: StoreActionResult<T>) {
			completedCallback();
			if (!result.withErrors || count > this.persistence) {
				subscription.unsubscribe();
			} else {
				count ++;
				result.retryAll();
			}
		});
	}
}

export class AsyncPassiveActionManager<T> extends BaseActionManager<T> {
	actionManager(action: StoreAction<T>, completedCallback: () => void) {
		const subscription = action.observable.subscribe(function(result: StoreActionResult<T>) {
			completedCallback();
			subscription.unsubscribe();
		});
	}
}
