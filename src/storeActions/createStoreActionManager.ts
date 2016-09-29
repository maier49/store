import { StoreAction, StoreUpdateFunction, StoreUpdateResult, StoreActionDatum } from './StoreAction';
import { after }  from 'dojo-core/aspect';
import Promise from 'dojo-shim/Promise';
import compose from 'dojo-compose/compose';

export interface StoreActionManager<T> {
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

function isAction<T>(updateOrAction: StoreAction<T> | StoreAction<T>[] | StoreUpdateFunction<T, StoreActionDatum<T>> | (() => Promise<any>)): updateOrAction is StoreAction<T> {
	return typeof (<any> updateOrAction).do === 'function';
}

const createAsyncPassiveActionManager = compose<StoreActionManager<{}>, {}>({
	waitingOperations: [],

	actionManager(action: StoreAction<{}>, completedCallback: () => void) {
		const subscription = action.observable.subscribe(function() {
			setTimeout(function() {
				completedCallback();
				subscription.unsubscribe();
			}, 0);
		});
	},
	queue<U extends StoreActionDatum<{}>>(this: StoreActionManager<{}>, actionActionsOrUpdateFunction: StoreAction<{}> | StoreAction<{}>[] | StoreUpdateFunction<{}, U> | (() => Promise<U>)): any {
		if (actionActionsOrUpdateFunction instanceof Array) {
			this.waitingOperations.push(...(<StoreAction<{}>[]> actionActionsOrUpdateFunction));
		}
		else if (isAction<{}>(actionActionsOrUpdateFunction)) {
			this.waitingOperations.push(actionActionsOrUpdateFunction);
		}
		else {
			const self = this;
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
	},

	retry<U extends StoreActionDatum<{}>>(this: StoreActionManager<{}>, actionActionsOrUpdateFunction: StoreAction<{}> | StoreUpdateFunction<{}, U> | (() => Promise<U>)): any {
		return this.queue(<any> actionActionsOrUpdateFunction);
	}
}, function<T>(instance: StoreActionManager<T>) {

	const self = instance;

	let processing = false;
	function processNext() {
		if (self.waitingOperations.length) {
			processing = true;
			const nextActionOrUpdate = self.waitingOperations.shift();
			if (isAction<T>(nextActionOrUpdate)) {
				self.actionManager(nextActionOrUpdate, processNext);
				nextActionOrUpdate.do();
			}
			else {
				nextActionOrUpdate().then(processNext);
			}
		}
		else {
			processing = false;
		}
	}

	after(self, 'queue', function(returnVal: any) {
		if (!processing) {
			processNext();
		}
		return returnVal;
	});
});

export default createAsyncPassiveActionManager;
