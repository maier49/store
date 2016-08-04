// import Query from './Query';
// import { Patch, diff } from '../patch/Patch';
// import filterFactory, { Filter } from './Filter';
// import { Store, BaseStore, StoreOptions } from './Store';
// import Promise from 'dojo-shim/Promise';
// import request, { Response, RequestOptions } from 'dojo-core/request';
//
// export interface RequestStoreOptions<T, U extends Store<T>> extends StoreOptions<T, U> {
// 	target: string;
// 	filterSerializer?: (filter: Filter<T>) => string;
// 	sendPatches?: boolean;
// }
//
// export class RequestStore<T> extends BaseStore<T, RequestStore<T>> {
// 	private target: string;
// 	private filterSerializer: (filter: Filter<T>) => string;
// 	private sendPatches: boolean;
//
// 	constructor(options: RequestStoreOptions<T, RequestStore<T>>) {
// 		super();
// 		this.target = options.target;
// 		this.filterSerializer = options.filterSerializer;
// 		this.sendPatches = Boolean(options.sendPatches);
// 	}
//
// 	createFilter() {
// 		return filterFactory(this.filterSerializer);
// 	}
//
// 	fetch(): Promise<T[]> {
// 		const filterString = this.queries.reduce((prev: Filter<T>, next: Query<T>) => {
// 			if (isFilter(next)) {
// 				return prev ? prev.and(next) : next;
// 			} else {
// 				return prev;
// 			}
// 		}, null).toString();
// 		return request.get(this.target + '?' + filterString).then(function(response: Response<string>) {
// 			return JSON.parse(response.data);
// 		});
// 	}
//
// 	getId(item: T): Promise<string> {
// 		return Promise.resolve((<any> item).id);
// 	}
//
// 	generateId(): Promise<string> {
// 		return Promise.resolve('' + Math.random());
// 	}
//
// 	protected _get(id: string): Promise<T> {
// 		return Promise.resolve(null);
// 	}
//
// 	protected _put(itemOrId: String|T, patch?: Patch): Promise<ItemUpdated<T>> {
// 		let idPromise: Promise<string> = (patch ? Promise.resolve(<string> itemOrId) : this.getId(<T> itemOrId));
// 		return idPromise.then(function(id: string) {
// 			let requestOptions: RequestOptions;
// 			if (patch && this.sendPatches) {
// 				requestOptions = {
// 					method: 'patch',
// 					data: patch.toString(),
// 					headers: {
// 						'Content-Type': 'application/json'
// 					}
// 				};
// 			} else {
// 				requestOptions = {
// 					method: 'put',
// 					data: JSON.stringify(itemOrId),
// 					headers: {
// 						'Content-Type': 'application/json'
// 					}
// 				};
// 			}
// 			return request<string>(this.target + id, requestOptions).then(function(response) {
// 				const item = JSON.parse(response.data);
// 				const oldItem: T = patch ? null : <T> itemOrId;
// 				return {
// 					item: item,
// 					type: UpdateType.Updated,
// 					diff: () => patch ? patch : diff(oldItem, item)
// 				};
// 			});
// 		}.bind(this));
// 	}
//
// 	protected _add(item: T, index?: number): Promise<ItemAdded<T>> {
// 		return request.post<string>(this.target, {
// 			data: JSON.stringify(item),
// 			headers: {
// 				'Content-Type': 'application/json'
// 			}
// 		}).then(function(response) {
// 			return {
// 				item: JSON.parse(response.data),
// 				type: UpdateType.Added
// 			};
// 		});
// 	}
//
// 	protected _getOptions(): RequestStoreOptions<T, RequestStore<T>> {
// 		return {
// 			target: this.target,
// 			filterSerializer: this.filterSerializer,
// 			sendPatches: this.sendPatches
// 		};
// 	}
//
// 	protected _delete(id: string, index?: number): Promise<ItemDeleted> {
// 		return  Promise.resolve({
// 			id: id,
// 			index: index,
// 			type: UpdateType.Deleted
// 		});
// 	}
//
// 	protected _handleUpdate(update: Update<T>): void {
// 	}
//
// 	protected _isUpdate(item: T): Promise<boolean> {
// 		return Promise.resolve(false);
// 	}
//
// }
