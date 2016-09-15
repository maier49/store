import { SubcollectionStore } from '../createSubcollectionStore';
import { CrudOptions } from '../createStore';
import { UpdateResults } from '../../storage/createInMemoryStorage';

export interface TrackAndFork<T, O extends CrudOptions, U extends UpdateResults<T>> extends SubcollectionStore<T, O, U, TrackAndFork<T, O , U>> {
	track(): Promise<TrackAndFork<T, O, U>>;
	fork(): Promise<TrackAndFork<T, O, U>>;
}
