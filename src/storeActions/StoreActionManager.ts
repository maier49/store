import { StoreAction, StoreActionResult } from './StoreAction';
import { after }  from 'dojo-core/aspect';

interface StoreActionManager<T> {
	readonly waitingActions: StoreAction<T>[];
	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;
}

export default StoreActionManager;

export abstract class BaseActionManager<T> implements StoreActionManager<T> {
	waitingActions: StoreAction<T>[] = [];

	abstract actionManager(actionResult: StoreAction<T>, completedCallback: () => void): void;

	constructor() {
		const self = <BaseActionManager<T>> this;

		let processing = false;
		function processNext() {
			if (self.waitingActions.length) {
				processing = true;
				const nextAction = self.waitingActions.shift();
				self.actionManager(nextAction, processNext);
				nextAction.do();
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

	queue(action: StoreAction<T>): void;
	queue(actions: StoreAction<T>[]): void;
	queue(actionOrActions: StoreAction<T> | StoreAction<T>[]): void {
		if (actionOrActions instanceof Array) {
			this.waitingActions.push(...(<StoreAction<T>[]> actionOrActions));
		} else {
			this.waitingActions.push(<StoreAction<T>> actionOrActions);
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
