import { StoreAction, StoreActionResult, StoreUpdateFunction, StoreUpdateResult, StoreActionDatum } from './StoreAction';
import { after }  from 'dojo-core/aspect';
import Promise from 'dojo-shim/Promise';

interface StoreActionManager<T> {
	readonly waitingOperations: Array<StoreAction<T> | StoreUpdateFunction<T, StoreActionDatum<T>> | (() => Promise<any>)>;
	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	queue<T, U extends StoreActionDatum<T>>(updateFunction: StoreUpdateFunction<T, U>): Promise<StoreUpdateResult<T, U>>;
	queue<T>(nonUpdate: () => Promise<T>): Promise<T>;
	actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;
}

export default StoreActionManager;

function isAction<T>(updateOrAction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T, StoreActionDatum<T>> | (() => Promise<any>)): updateOrAction is StoreAction<T> {
	return typeof (<any> updateOrAction).do === 'function';
}

export abstract class BaseActionManager<T> implements StoreActionManager<T> {
	waitingOperations: Array<StoreAction<T> | StoreUpdateFunction<T, StoreActionDatum<T>>> = [];

	abstract actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;

	constructor() {
		const self = <BaseActionManager<T>> this;

		let processing = false;
		function processNext() {
			if (self.waitingOperations.length) {
				processing = true;
				const nextActionOrUpdate = self.waitingOperations.shift();
				if (isAction<T>(nextActionOrUpdate)) {
					self.actionManager(nextActionOrUpdate, processNext);
					nextActionOrUpdate.do();
				} else {
					nextActionOrUpdate().then(processNext);
				}
			} else {
				processing = false;
			}
		}

		after(self, 'queue', function(returnVal: any) {
			if (!processing) {
				processNext();
			}
			return returnVal;
		});
	}
	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	queue<U extends StoreActionDatum<T>>(updateFunction: StoreUpdateFunction<T, U>): Promise<StoreUpdateResult<T, U>>;
	queue<U>(nonUpdateFunction: () => Promise<U>): Promise<U>;
	queue<U extends StoreActionDatum<T>>(actionActionsOrUpdateFunction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T, U> | (() => Promise<U>)): void | Promise<StoreUpdateResult<T, U>> | Promise<U> {
		if (actionActionsOrUpdateFunction instanceof Array) {
			this.waitingOperations.push(...(<StoreAction<T>[]> actionActionsOrUpdateFunction));
		} else if (isAction<T>(actionActionsOrUpdateFunction)) {
			this.waitingOperations.push(actionActionsOrUpdateFunction);
		} else {
			const self = <StoreActionManager<T>> this;
			return new Promise(function(resolve) {
				self.waitingOperations.push(function() {
					return (<() => Promise<any>> actionActionsOrUpdateFunction)()
						.then(function(result: any) {
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
		const subscription = action.observable.subscribe(function(this: SyncAggressiveActionManager<T>, result: StoreActionResult<T>) {
			if (!result.withConflicts || count > this.persistence) {
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
		const subscription = action.observable.subscribe(function(this: AsyncAgressiveActionManager<T>, result: StoreActionResult<T>) {
			completedCallback();
			if (!result.withConflicts || count > this.persistence) {
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
