import { StoreAction, StoreUpdateFunction, StoreUpdateResult, StoreActionDatum } from './StoreAction';
import { after }  from 'dojo-core/aspect';
import Promise from 'dojo-shim/Promise';

interface StoreActionManager<T> {
	readonly waitingOperations: Array<StoreAction<T> | StoreUpdateFunction<T, StoreActionDatum<T>> | (() => Promise<any>)>;
	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	queue<T, U extends StoreActionDatum<T>>(updateFunction: StoreUpdateFunction<T, U>): Promise<StoreUpdateResult<T, U>>;
	queue<T>(nonUpdate: () => Promise<T>): Promise<T>;
	retry(action: StoreAction<T>): void;
	retry<T, U extends StoreActionDatum<T>>(updateFunction: StoreUpdateFunction<T, U>): Promise<StoreUpdateResult<T, U>>;
	retry<T>(nonUpdate: () => Promise<T>): Promise<T>;
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

	retry(action: StoreAction<T>): void;
	retry<U extends StoreActionDatum<T>>(updateFunction: StoreUpdateFunction<T, U>): Promise<StoreUpdateResult<T, U>>;
	retry<U>(nonUpdateFunction: () => Promise<U>): Promise<U>;
	retry<U extends StoreActionDatum<T>>(actionActionsOrUpdateFunction: StoreAction<T> | StoreUpdateFunction<T, U> | (() => Promise<U>)): void | Promise<StoreUpdateResult<T, U>> | Promise<U> {
		return this.queue(<any> actionActionsOrUpdateFunction);
	}
}

export class AsyncPassiveActionManager<T> extends BaseActionManager<T> {
	actionManager(action: StoreAction<T>, completedCallback: () => void) {
		const subscription = action.observable.subscribe(function() {
			setTimeout(function() {
				completedCallback();
				subscription.unsubscribe();
			}, 0);
		});
	}
}
